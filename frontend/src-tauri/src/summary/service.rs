use crate::database::repositories::{
    meeting::MeetingsRepository, setting::SettingsRepository, summary::SummaryProcessesRepository,
};
use crate::summary::llm_client::LLMProvider;
use crate::summary::language_detection::detect_summary_language;
use crate::summary::metadata::read_detected_summary_language_from_metadata;
use crate::summary::processor::{
    extract_meeting_name_from_markdown, generate_meeting_summary, language_name_from_code,
};
use crate::summary::templates::{self, Template};
use crate::ollama::metadata::ModelMetadataCache;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use once_cell::sync::Lazy;

// Global cache for model metadata (5 minute TTL)
pub(crate) static METADATA_CACHE: Lazy<ModelMetadataCache> = Lazy::new(|| {
    ModelMetadataCache::new(Duration::from_secs(300))
});

// Global registry for cancellation tokens (thread-safe)
static CANCELLATION_REGISTRY: Lazy<Arc<Mutex<HashMap<String, CancellationToken>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Owns one meeting's generation from admission through its final database write.
/// Dropping on startup failure, early return, or task abort also releases admission.
pub(crate) struct SummaryJob {
    meeting_id: String,
    cancellation_token: CancellationToken,
}

impl Drop for SummaryJob {
    fn drop(&mut self) {
        if let Ok(mut registry) = CANCELLATION_REGISTRY.lock() {
            registry.remove(&self.meeting_id);
        }
    }
}

/// Strips the first `#` heading line; returns "" if no `#` is found.
fn strip_leading_title(markdown: &str) -> String {
    if let Some(hash_pos) = markdown.find('#') {
        let body_start = markdown[hash_pos..]
            .find('\n')
            .map_or(markdown.len(), |line_end| hash_pos + line_end);
        markdown[body_start..].trim_start().to_string()
    } else {
        String::new()
    }
}

/// Strips the leading H1 (`# Title\n...`) only when the markdown starts with one.
/// No-op on already-stripped values, values starting with `## Subheading`, or values
/// without any heading. Avoids the silent-empty-return case where `strip_leading_title`
/// returns "" for input lacking a leading `#`.
fn strip_title_if_present(markdown: &str) -> String {
    if markdown.trim_start().starts_with("# ") {
        strip_leading_title(markdown)
    } else {
        markdown.to_string()
    }
}

const ENGLISH_CACHE_FIELD: &str = "english_cache";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct SummaryCacheSource {
    report_instructions_fingerprint: String,
    transcript_fingerprint: String,
    custom_prompt_fingerprint: String,
    template_id: String,
    template_fingerprint: String,
    token_threshold: usize,
    model_provider: String,
    model_name: String,
    ollama_endpoint: Option<String>,
    custom_openai_endpoint: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct EnglishSummaryCache {
    markdown: String,
    source: SummaryCacheSource,
    output_language: Option<String>,
}

fn stable_text_fingerprint(text: &str) -> String {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{:016x}:{}", hash, text.len())
}

#[allow(clippy::too_many_arguments)]
fn build_summary_cache_source(
    text: &str,
    custom_prompt: &str,
    template_id: &str,
    template_fingerprint: &str,
    token_threshold: usize,
    model_provider: &str,
    model_name: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
) -> SummaryCacheSource {
    SummaryCacheSource {
        // A language switch must not reuse a report generated with older factual
        // rules. Template contents have their own fingerprint below.
        report_instructions_fingerprint: stable_text_fingerprint(
            &super::processor::build_final_report_system_prompt("", ""),
        ),
        transcript_fingerprint: stable_text_fingerprint(text),
        custom_prompt_fingerprint: stable_text_fingerprint(custom_prompt),
        template_id: template_id.to_string(),
        template_fingerprint: template_fingerprint.to_string(),
        token_threshold,
        model_provider: model_provider.to_string(),
        model_name: model_name.to_string(),
        ollama_endpoint: ollama_endpoint.map(str::to_string),
        custom_openai_endpoint: custom_openai_endpoint.map(str::to_string),
        max_tokens,
        temperature,
        top_p,
    }
}

fn template_cache_fingerprint(template: &Template) -> String {
    let rendered_template = format!(
        "{}\n---SECTION-INSTRUCTIONS---\n{}",
        template.to_markdown_structure(),
        template.to_section_instructions()
    );
    stable_text_fingerprint(&rendered_template)
}

fn normalise_summary_language_for_cache(summary_language: Option<&str>) -> Option<String> {
    language_name_from_code(summary_language?.trim()).map(str::to_string)
}

fn build_summary_result_json(
    final_markdown: &str,
    english_markdown: &str,
    source: SummaryCacheSource,
    output_language: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "markdown": strip_title_if_present(final_markdown),
        ENGLISH_CACHE_FIELD: EnglishSummaryCache {
            markdown: english_markdown.to_string(),
            source,
            output_language: normalise_summary_language_for_cache(output_language),
        },
    })
}

/// Parses a `summary_processes.result` JSON blob and extracts a cached English
/// summary only when it was produced from exactly the same source inputs and
/// the user is switching to a different non-English target language.
fn extract_cached_english_markdown(
    raw: &str,
    expected_source: &SummaryCacheSource,
    requested_language: Option<&str>,
) -> Result<Option<String>, serde_json::Error> {
    let requested_language = match normalise_summary_language_for_cache(requested_language) {
        Some(language) if language != "English" => language,
        _ => return Ok(None),
    };

    let value: serde_json::Value = serde_json::from_str(raw)?;
    let Some(cache_value) = value.get(ENGLISH_CACHE_FIELD) else {
        return Ok(None);
    };

    let cache: EnglishSummaryCache = match serde_json::from_value(cache_value.clone()) {
        Ok(cache) => cache,
        Err(_) => return Ok(None),
    };

    if cache.source != *expected_source {
        return Ok(None);
    }

    if cache.output_language.as_deref() == Some(requested_language.as_str()) {
        return Ok(None);
    }

    let markdown = cache.markdown.trim();
    if markdown.is_empty() {
        Ok(None)
    } else {
        Ok(Some(cache.markdown))
    }
}

/// Summary service - handles all summary generation logic
pub struct SummaryService;

impl SummaryService {
    /// Reserve before resetting stored state, not inside the background task.
    pub(crate) fn try_start_summary(meeting_id: &str) -> Result<SummaryJob, String> {
        let mut registry = CANCELLATION_REGISTRY.lock()
            .map_err(|_| "Could not check active enhancements. Please restart the app.".to_string())?;
        if registry.contains_key(meeting_id) {
            return Err("An enhancement is already running for this meeting. Wait for it to finish before trying again.".to_string());
        }
        let token = CancellationToken::new();
        registry.insert(meeting_id.to_string(), token.clone());
        Ok(SummaryJob { meeting_id: meeting_id.to_string(), cancellation_token: token })
    }

    /// Cancels the summary generation for a meeting
    pub fn cancel_summary(meeting_id: &str) -> bool {
        if let Ok(registry) = CANCELLATION_REGISTRY.lock() {
            if let Some(token) = registry.get(meeting_id) {
                info!("Cancelling summary generation for meeting: {}", meeting_id);
                token.cancel();
                return true;
            }
        }
        warn!("No active summary generation found for meeting: {}", meeting_id);
        false
    }

    async fn read_detected_summary_language(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Option<String> {
        let meeting = match MeetingsRepository::get_meeting_metadata(pool, meeting_id).await {
            Ok(Some(meeting)) => meeting,
            Ok(None) => {
                warn!("Meeting not found while reading detected summary language: {}", meeting_id);
                return None;
            }
            Err(e) => {
                warn!(
                    "Failed to read meeting metadata for detected summary language (meeting_id={}): {}",
                    meeting_id, e
                );
                return None;
            }
        };

        let Some(folder_path) = meeting.folder_path.filter(|p| !p.trim().is_empty()) else {
            return None;
        };

        match read_detected_summary_language_from_metadata(Path::new(&folder_path)) {
            Ok(language) => language,
            Err(e) => {
                warn!(
                    "Failed to read detected summary language metadata for meeting_id={}: {}",
                    meeting_id, e
                );
                None
            }
        }
    }

    fn detect_summary_language_from_text(text: &str) -> Option<String> {
        let transcript_texts = [text.to_string()];
        let detection = detect_summary_language(&transcript_texts);
        match &detection.language {
            Some(language) => {
                info!("Detected transcript summary language for normalization: {}", language);
            }
            None => {
                info!(
                    "Transcript summary language unknown for normalization: {:?}",
                    detection.reason
                );
            }
        }
        detection.language
    }

    /// Processes transcript in the background and generates summary
    ///
    /// This function is designed to be spawned as an async task and does not block
    /// the main thread. It updates the database with progress and results.
    ///
    /// # Arguments
    /// * `_app` - Tauri app handle (for future use)
    /// * `pool` - SQLx connection pool
    /// * `meeting_id` - Unique identifier for the meeting
    /// * `text` - Full transcript text
    /// * `model_provider` - LLM provider name (e.g., "ollama", "openai")
    /// * `model_name` - Specific model (e.g., "gpt-4", "llama3.2:latest")
    /// * `custom_prompt` - Optional user-provided context
    /// * `template_id` - Template identifier (e.g., "daily_standup", "standard_meeting")
    pub(crate) async fn process_transcript_background<R: tauri::Runtime>(
        _app: AppHandle<R>,
        pool: SqlitePool,
        job: SummaryJob,
        text: String,
        model_provider: String,
        model_name: String,
        custom_prompt: String,
        template_id: String,
        summary_language: Option<String>,
    ) {
        let meeting_id = job.meeting_id.clone();
        let cancellation_token = &job.cancellation_token;
        let start_time = Instant::now();
        info!(
            "Starting background processing for meeting_id: {}",
            meeting_id
        );

        // Parse provider
        let provider = match LLMProvider::from_str(&model_provider) {
            Ok(p) => p,
            Err(e) => {
                Self::update_process_failed(&pool, &meeting_id, &e).await;
                return;
            }
        };

        // Validate and setup api_key, Flexible for Ollama, BuiltInAI, and CustomOpenAI
        let api_key = if provider == LLMProvider::Ollama || provider == LLMProvider::BuiltInAI || provider == LLMProvider::CustomOpenAI {
            // These providers don't require API keys from the standard database column
            String::new()
        } else {
            match SettingsRepository::get_api_key(&pool, &model_provider).await {
                Ok(Some(key)) if !key.is_empty() => key,
                Ok(None) | Ok(Some(_)) => {
                    let err_msg = format!("API key not found for {}", &model_provider);
                    Self::update_process_failed(&pool, &meeting_id, &err_msg).await;
                    return;
                }
                Err(e) => {
                    let err_msg = format!("Failed to retrieve API key for {}: {}", &model_provider, e);
                    Self::update_process_failed(&pool, &meeting_id, &err_msg).await;
                    return;
                }
            }
        };

        // Get Ollama endpoint if provider is Ollama
        let ollama_endpoint = if provider == LLMProvider::Ollama {
            match SettingsRepository::get_model_config(&pool).await {
                Ok(Some(config)) => config.ollama_endpoint,
                Ok(None) => None,
                Err(e) => {
                    info!("Failed to retrieve Ollama endpoint: {}, using default", e);
                    None
                }
            }
        } else {
            None
        };

        // Get CustomOpenAI config if provider is CustomOpenAI
        let (custom_openai_endpoint, custom_openai_api_key, custom_openai_max_tokens, custom_openai_temperature, custom_openai_top_p) =
            if provider == LLMProvider::CustomOpenAI {
                match SettingsRepository::get_custom_openai_config(&pool).await {
                    Ok(Some(config)) => {
                        info!("✓ Using custom OpenAI endpoint: {}", config.endpoint);
                        (
                            Some(config.endpoint),
                            config.api_key,
                            config.max_tokens.map(|t| t as u32),
                            config.temperature,
                            config.top_p,
                        )
                    }
                    Ok(None) => {
                        let err_msg = "Custom OpenAI provider selected but no configuration found";
                        Self::update_process_failed(&pool, &meeting_id, err_msg).await;
                        return;
                    }
                    Err(e) => {
                        let err_msg = format!("Failed to retrieve custom OpenAI config: {}", e);
                        Self::update_process_failed(&pool, &meeting_id, &err_msg).await;
                        return;
                    }
                }
            } else {
                (None, None, None, None, None)
            };

        // For CustomOpenAI, use its API key (if any) instead of the empty string
        let final_api_key = if provider == LLMProvider::CustomOpenAI {
            custom_openai_api_key.unwrap_or_default()
        } else {
            api_key
        };

        // Vercel AI Gateway requires a user API key. Fail cleanly without blocking recording.
        if provider == LLMProvider::CustomOpenAI {
            if let Some(ref endpoint) = custom_openai_endpoint {
                let is_gateway = {
                    #[cfg(feature = "afterword")]
                    {
                        crate::afterword::defaults::is_gateway_endpoint(endpoint)
                    }
                    #[cfg(not(feature = "afterword"))]
                    {
                        let trimmed = endpoint.trim().trim_end_matches('/');
                        trimmed.eq_ignore_ascii_case("https://ai-gateway.vercel.sh/v1")
                    }
                };
                if is_gateway && final_api_key.trim().is_empty() {
                    let err_msg = "Vercel AI Gateway API key is missing. Add it under Settings → Summary (Custom Server / AI Gateway). Recording still works offline.";
                    Self::update_process_failed(&pool, &meeting_id, err_msg).await;
                    return;
                }
            }
        }

        // Dynamically fetch context size based on provider and model
        let token_threshold = if provider == LLMProvider::Ollama {
            match METADATA_CACHE.get_or_fetch(&model_name, ollama_endpoint.as_deref()).await {
                Ok(metadata) => {
                    // The processor budgets full prompts and answer space together.
                    let optimal = metadata.context_size;
                    info!(
                        "✓ Using dynamic context for {}: {} tokens (chunk size: {})",
                        model_name, metadata.context_size, optimal
                    );
                    optimal
                }
                Err(e) => {
                    warn!(
                        "Failed to fetch context for {}: {}. Using default 4000",
                        model_name, e
                    );
                    4000  // Fallback to safe default
                }
            }
        } else if provider == LLMProvider::BuiltInAI {
            // Get model's context size from registry
            use crate::summary::summary_engine::models;
            let model = models::get_model_by_name(&model_name)
                .ok_or_else(|| format!("Unknown model: {}", model_name));

            match model {
                Ok(model_def) => {
                    let optimal = model_def.context_size as usize;
                    info!(
                        "✓ Using BuiltInAI context size: {} tokens (chunk size: {})",
                        model_def.context_size, optimal
                    );
                    optimal
                }
                Err(e) => {
                    warn!("{}, using default 2048", e);
                    2048
                }
            }
        } else {
            // Cloud providers (OpenAI, Claude, Groq, CustomOpenAI) handle large contexts automatically
            100000  // Effectively unlimited for single-pass processing
        };

        // Get app data directory for BuiltInAI provider
        let app_data_dir = _app.path().app_data_dir().ok();

        if let Some(code) = &summary_language {
            info!("📝 Summary language preference: {}", code);
        }

        let detected_summary_language =
            Self::read_detected_summary_language(&pool, &meeting_id)
                .await
                .or_else(|| Self::detect_summary_language_from_text(&text));

        if let Some(code) = &detected_summary_language {
            info!("📝 Detected transcript summary language: {}", code);
        }

        let template = match templates::get_template(&template_id) {
            Ok(template) => template,
            Err(e) => {
                let err_msg = format!("Failed to load template '{}': {}", template_id, e);
                Self::update_process_failed(&pool, &meeting_id, &err_msg).await;
                return;
            }
        };
        let template_fingerprint = template_cache_fingerprint(&template);

        let cache_source = build_summary_cache_source(
            &text,
            &custom_prompt,
            &template_id,
            &template_fingerprint,
            token_threshold,
            &model_provider,
            &model_name,
            ollama_endpoint.as_deref(),
            custom_openai_endpoint.as_deref(),
            custom_openai_max_tokens,
            custom_openai_temperature,
            custom_openai_top_p,
        );

        let cached_english = match SummaryProcessesRepository::get_summary_data(&pool, &meeting_id).await {
            Err(e) => {
                warn!(
                    "Failed to load prior summary row for cache lookup (meeting_id={}): {}. Falling back to full pass-1 generation.",
                    meeting_id, e
                );
                None
            }
            Ok(None) => None,
            Ok(Some(process)) => process.result.and_then(|raw| {
                match extract_cached_english_markdown(
                    &raw,
                    &cache_source,
                    summary_language.as_deref(),
                ) {
                    Ok(opt) => opt,
                    Err(e) => {
                        warn!(
                            "Cached summary result for meeting_id={} is not valid JSON ({}); ignoring cache.",
                            meeting_id, e
                        );
                        None
                    }
                }
            }),
        };

        let client = reqwest::Client::new();
        let generation_started = Instant::now();
        let preparation_ms = start_time.elapsed().as_millis();
        let result = generate_meeting_summary(
            &client,
            &provider,
            &model_name,
            &final_api_key,
            &text,
            &custom_prompt,
            &template_id,
            &template,
            token_threshold,
            ollama_endpoint.as_deref(),
            custom_openai_endpoint.as_deref(),
            custom_openai_max_tokens,
            custom_openai_temperature,
            custom_openai_top_p,
            app_data_dir.as_ref(),
            Some(cancellation_token),
            summary_language.as_deref(),
            detected_summary_language.as_deref(),
            cached_english.as_deref(),
        )
        .await;

        let duration = start_time.elapsed().as_secs_f64();
        let generation_ms = generation_started.elapsed().as_millis();

        match result {
            Ok((final_markdown, english_markdown, num_chunks)) => {
                info!(
                    "✓ Successfully processed {} chunks for meeting_id: {}. Duration: {:.2}s",
                    num_chunks, meeting_id, duration
                );
                info!("Final markdown generated ({} chars)", final_markdown.len());

                let result_json = build_summary_result_json(
                    &final_markdown,
                    &english_markdown,
                    cache_source,
                    summary_language.as_deref(),
                );

                let persistence_started = Instant::now();
                let saved = Self::persist_completed_summary(
                    &pool,
                    &meeting_id,
                    result_json,
                    num_chunks,
                    duration,
                    extract_meeting_name_from_markdown(&final_markdown).as_deref(),
                )
                .await;
                if saved {
                    let persistence_ms = persistence_started.elapsed().as_millis();
                    info!(
                        "Enhancement timing meeting_id={} preparation_ms={} generation_ms={} persistence_ms={}",
                        meeting_id, preparation_ms, generation_ms, persistence_ms
                    );
                    // Notify only after the result and suggested title are persisted.
                    // The event is a hint; observers still read authoritative saved data.
                    if let Err(error) = _app.emit("summary-completed", serde_json::json!({
                        "meeting_id": meeting_id,
                        "saved_at_ms": chrono::Utc::now().timestamp_millis(),
                    })) {
                        warn!("Could not publish enhancement completion; polling will recover: {}", error);
                    }
                }
            }
            Err(e) => {
                // Check if error is due to cancellation
                if e.contains("cancelled") {
                    info!("Summary generation was cancelled for meeting_id: {}", meeting_id);
                    if let Err(db_err) = SummaryProcessesRepository::update_process_cancelled(&pool, &meeting_id).await {
                        error!("Failed to update DB status to cancelled for {}: {}", meeting_id, db_err);
                    }
                } else {
                    Self::update_process_failed(&pool, &meeting_id, &e).await;
                }
            }
        }
    }

    /// A generated result is successful only after storage accepts it.
    async fn persist_completed_summary(
        pool: &SqlitePool,
        meeting_id: &str,
        result: serde_json::Value,
        chunk_count: i64,
        duration: f64,
        suggested_name: Option<&str>,
    ) -> bool {
        if let Err(e) = SummaryProcessesRepository::update_process_completed(
            pool, meeting_id, result, chunk_count, duration,
        )
        .await
        {
            error!("Failed to save completed process for {}: {}", meeting_id, e);
            Self::update_process_failed(
                pool,
                meeting_id,
                "Could not save enhanced notes. Try again when local storage is available.",
            )
            .await;
            return false;
        }

        info!("Summary saved successfully for meeting_id: {}", meeting_id);
        if let Some(name) = suggested_name.filter(|name| !name.is_empty()) {
            match MeetingsRepository::suggest_meeting_name(pool, meeting_id, name).await {
                Ok(true) => info!("Named previously untitled meeting {}", meeting_id),
                Ok(false) => info!("Preserved existing title for meeting {}", meeting_id),
                Err(e) => error!("Failed to update meeting name for {}: {}", meeting_id, e),
            }
        }
        true
    }

    /// Updates the summary process status to failed with error message
    ///
    /// # Arguments
    /// * `pool` - SQLx connection pool
    /// * `meeting_id` - Meeting identifier
    /// * `error_msg` - Error message to store
    async fn update_process_failed(pool: &SqlitePool, meeting_id: &str, error_msg: &str) {
        error!(
            "Processing failed for meeting_id {}: {}",
            meeting_id, error_msg
        );
        if let Err(e) =
            SummaryProcessesRepository::update_process_failed(pool, meeting_id, error_msg).await
        {
            error!(
                "Failed to update DB status to failed for {}: {}",
                meeting_id, e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn summary_storage_fixture() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings (id,title,created_at,updated_at) VALUES ('save-test','Untitled','','original')")
            .execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn summary_storage_failure_restores_current_and_history_then_allows_retry() {
        let pool = summary_storage_fixture().await;
        let first = serde_json::json!({"markdown": "First"});
        let second = serde_json::json!({"markdown": "Second", "summary_json": [{"type": "checkListItem", "props": {"checked": true}}]});
        let third = serde_json::json!({"markdown": "Third"});
        for result in [&first, &second] {
            SummaryProcessesRepository::create_or_reset_process(&pool, "save-test").await.unwrap();
            assert!(SummaryService::persist_completed_summary(&pool, "save-test", result.clone(), 1, 1.0, None).await);
        }
        let history_before: (String, String) = sqlx::query_as("SELECT version_id,result FROM previous_summaries WHERE meeting_id='save-test'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&history_before.1).unwrap(), first);
        SummaryProcessesRepository::create_or_reset_process(&pool, "save-test").await.unwrap();
        // Abort after the history trigger ran: the entire completion write must roll back.
        sqlx::query("CREATE TRIGGER reject_completion AFTER UPDATE ON summary_processes WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT, 'Synthetic completion write failure'); END")
            .execute(&pool).await.unwrap();
        assert!(!SummaryService::persist_completed_summary(&pool, "save-test", third.clone(), 1, 1.0, Some("Generated title")).await);
        let failed = SummaryProcessesRepository::get_summary_data(&pool, "save-test").await.unwrap().unwrap();
        assert_eq!(failed.status, "failed");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&failed.result.unwrap()).unwrap(), second);
        assert!(failed.error.unwrap().contains("Could not save enhanced notes"));
        let backup: Option<String> = sqlx::query_scalar("SELECT result_backup FROM summary_processes WHERE meeting_id='save-test'").fetch_one(&pool).await.unwrap();
        assert!(backup.is_none());
        let history_after: (String, String) = sqlx::query_as("SELECT version_id,result FROM previous_summaries WHERE meeting_id='save-test'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(history_after, history_before);
        let title: String = sqlx::query_scalar("SELECT title FROM meetings WHERE id='save-test'").fetch_one(&pool).await.unwrap();
        assert_eq!(title, "Untitled", "An unsaved result must not rename the note");

        sqlx::query("DROP TRIGGER reject_completion").execute(&pool).await.unwrap();
        SummaryProcessesRepository::create_or_reset_process(&pool, "save-test").await.unwrap();
        assert!(SummaryService::persist_completed_summary(&pool, "save-test", third.clone(), 1, 1.0, Some("Generated title")).await);
        let completed = SummaryProcessesRepository::get_summary_data(&pool, "save-test").await.unwrap().unwrap();
        assert_eq!(completed.status, "completed");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&completed.result.unwrap()).unwrap(), third);
        assert!(completed.error.is_none());
        let previous: String = sqlx::query_scalar("SELECT result FROM previous_summaries WHERE meeting_id='save-test'").fetch_one(&pool).await.unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&previous).unwrap(), second);
        let title: String = sqlx::query_scalar("SELECT title FROM meetings WHERE id='save-test'").fetch_one(&pool).await.unwrap();
        assert_eq!(title, "Generated title");
    }

    #[tokio::test]
    async fn summary_storage_rejects_missing_or_active_edit_targets() {
        let pool = summary_storage_fixture().await;
        let original = serde_json::json!({"markdown": "Original"});
        let edited = serde_json::json!({"markdown": "Edited"});
        assert!(!SummaryProcessesRepository::update_meeting_summary(&pool, "save-test", &edited).await.unwrap());
        assert!(!SummaryProcessesRepository::update_meeting_summary(&pool, "missing", &edited).await.unwrap());
        assert!(matches!(SummaryProcessesRepository::update_process_completed(&pool, "save-test", original.clone(), 1, 1.0).await, Err(sqlx::Error::RowNotFound)));
        let timestamp: String = sqlx::query_scalar("SELECT updated_at FROM meetings WHERE id='save-test'").fetch_one(&pool).await.unwrap();
        assert_eq!(timestamp, "original");
        SummaryProcessesRepository::create_or_reset_process(&pool, "save-test").await.unwrap();
        SummaryProcessesRepository::update_process_failed(&pool, "save-test", "First attempt failed").await.unwrap();
        assert!(!SummaryProcessesRepository::update_meeting_summary(&pool, "save-test", &edited).await.unwrap(), "No saved enhancement exists after the first failure");
        SummaryProcessesRepository::create_or_reset_process(&pool, "save-test").await.unwrap();
        SummaryProcessesRepository::update_process_completed(&pool, "save-test", original.clone(), 1, 1.0).await.unwrap();
        SummaryProcessesRepository::create_or_reset_process(&pool, "save-test").await.unwrap();
        for status in ["PENDING", "processing"] {
            sqlx::query("UPDATE summary_processes SET status=? WHERE meeting_id='save-test'").bind(status).execute(&pool).await.unwrap();
            assert!(!SummaryProcessesRepository::update_meeting_summary(&pool, "save-test", &edited).await.unwrap());
            let (result, backup): (String, String) = sqlx::query_as("SELECT result,result_backup FROM summary_processes WHERE meeting_id='save-test'").fetch_one(&pool).await.unwrap();
            assert_eq!(serde_json::from_str::<serde_json::Value>(&result).unwrap(), original);
            assert_eq!(result, backup);
        }
        let timestamp: String = sqlx::query_scalar("SELECT updated_at FROM meetings WHERE id='save-test'").fetch_one(&pool).await.unwrap();
        assert_eq!(timestamp, "original");
        SummaryProcessesRepository::update_process_failed(&pool, "save-test", "Synthetic failure").await.unwrap();
        assert!(SummaryProcessesRepository::update_meeting_summary(&pool, "save-test", &edited).await.unwrap(), "Recovered enhancements remain editable");
        let saved = SummaryProcessesRepository::get_summary_data(&pool, "save-test").await.unwrap().unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&saved.result.unwrap()).unwrap(), edited);
    }

    #[test]
    fn summary_admission_allows_one_concurrent_job_per_meeting() {
        use std::sync::{Barrier, atomic::{AtomicUsize, Ordering}};
        let meeting = format!("admission-{}", uuid::Uuid::new_v4());
        let barrier = Barrier::new(12);
        let accepted = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..12 {
                scope.spawn(|| {
                    barrier.wait();
                    let job = SummaryService::try_start_summary(&meeting).ok();
                    if job.is_some() { accepted.fetch_add(1, Ordering::SeqCst); }
                    // Hold the winner until every competing attempt has finished.
                    barrier.wait();
                    drop(job);
                });
            }
        });
        assert_eq!(accepted.load(Ordering::SeqCst), 1);
        assert!(SummaryService::try_start_summary(&meeting).is_ok());
    }

    #[test]
    fn summary_admission_keeps_original_token_and_other_meetings_independent() {
        let meeting = format!("admission-{}", uuid::Uuid::new_v4());
        let first = SummaryService::try_start_summary(&meeting).unwrap();
        assert!(SummaryService::try_start_summary(&meeting).is_err());
        let other = SummaryService::try_start_summary(&format!("{meeting}-other")).unwrap();
        assert!(SummaryService::cancel_summary(&meeting));
        assert!(first.cancellation_token.is_cancelled());
        assert!(!other.cancellation_token.is_cancelled());
        assert!(SummaryService::try_start_summary(&meeting).is_err(), "Cancellation is not worker completion");
        drop(first);
        let retry = SummaryService::try_start_summary(&meeting).unwrap();
        assert!(!retry.cancellation_token.is_cancelled());
    }

    #[tokio::test]
    async fn summary_admission_releases_on_startup_error_and_task_abort() {
        let meeting = format!("admission-{}", uuid::Uuid::new_v4());
        let failed: Result<(), String> = async {
            let _job = SummaryService::try_start_summary(&meeting)?;
            Err("Synthetic storage failure".to_string())
        }.await;
        assert!(failed.is_err());
        let job = SummaryService::try_start_summary(&meeting).unwrap();
        let (ready, started) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let _job = job;
            ready.send(()).unwrap();
            std::future::pending::<()>().await;
        });
        started.await.unwrap();
        assert!(SummaryService::try_start_summary(&meeting).is_err());
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(SummaryService::try_start_summary(&meeting).is_ok());
    }

    #[test]
    fn test_strip_leading_title_with_body() {
        let input = "# Meeting Title\nThis is the body.\nMore content.";
        let result = strip_leading_title(input);
        assert_eq!(result, "This is the body.\nMore content.");
    }

    #[test]
    fn test_strip_leading_title_only() {
        let input = "# Meeting Title";
        let result = strip_leading_title(input);
        assert_eq!(result, "");
    }

    #[test]
    fn test_strip_leading_title_no_heading() {
        let input = "No heading here.\nJust body.";
        let result = strip_leading_title(input);
        assert_eq!(result, "");
    }

    #[test]
    fn test_strip_leading_title_multiline_body() {
        let input = "# Title\n## Subheading\nParagraph 1\n\nParagraph 2";
        let result = strip_leading_title(input);
        assert_eq!(result, "## Subheading\nParagraph 1\n\nParagraph 2");
    }

    #[test]
    fn test_strip_leading_title_empty_after_heading() {
        let input = "# Title\n";
        let result = strip_leading_title(input);
        assert_eq!(result, "");
    }

    #[test]
    fn test_strip_leading_title_whitespace_after_heading() {
        let input = "# Title\n   \n Body with leading spaces";
        let result = strip_leading_title(input);
        assert_eq!(result, "Body with leading spaces");
    }

    #[test]
    fn test_strip_title_if_present_preserves_already_stripped() {
        assert_eq!(strip_title_if_present("## Action Items\nfoo"), "## Action Items\nfoo");
    }

    #[test]
    fn test_strip_title_if_present_strips_leading_h1() {
        assert_eq!(strip_title_if_present("# Meeting Title\n## Action Items\nfoo"), "## Action Items\nfoo");
    }

    #[test]
    fn test_strip_title_if_present_no_heading_preserved() {
        // Distinct from strip_leading_title which returns "" — this preserves input.
        assert_eq!(strip_title_if_present("Just body text"), "Just body text");
    }

    #[test]
    fn test_strip_title_if_present_hash_no_space_preserved() {
        // `#NoSpace` is not a markdown H1 — preserve.
        assert_eq!(strip_title_if_present("#NoSpace\nbody"), "#NoSpace\nbody");
    }

    #[test]
    fn test_strip_title_if_present_mid_document_h1_preserved() {
        // H1 after body content must NOT be stripped — guards the asymmetry where
        // extract_meeting_name_from_markdown scans every line for "# ".
        let input = "Some paragraph\n\n# H1 on line 3\n## Section\nbody";
        assert_eq!(strip_title_if_present(input), input);
    }

    #[test]
    fn test_strip_title_if_present_leading_whitespace_h1_stripped() {
        assert_eq!(
            strip_title_if_present("  # Title\n## Section\nbody"),
            "## Section\nbody"
        );
    }

    fn sample_cache_source() -> SummaryCacheSource {
        let template_fingerprint = stable_text_fingerprint("standard template prompt");
        build_summary_cache_source(
            "transcript body",
            "custom prompt",
            "standard_meeting",
            &template_fingerprint,
            3700,
            "ollama",
            "gemma3:1b",
            Some("http://localhost:11434"),
            None,
            None,
            None,
            None,
        )
    }

    fn test_template(section_title: &str) -> Template {
        Template {
            name: "Test".to_string(),
            description: "Test template".to_string(),
            sections: vec![crate::summary::templates::TemplateSection {
                title: section_title.to_string(),
                instruction: "Summarize this section".to_string(),
                format: "paragraph".to_string(),
                item_format: None,
                example_item_format: None,
            }],
        }
    }

    #[test]
    fn test_template_cache_fingerprint_changes_with_rendered_template() {
        assert_ne!(
            template_cache_fingerprint(&test_template("Summary")),
            template_cache_fingerprint(&test_template("Decisions"))
        );
    }

    #[test]
    fn test_legacy_english_markdown_field_is_cache_miss() {
        let raw = serde_json::json!({
            "markdown": "translated",
            "english_markdown": "# Old English\nBody"
        })
        .to_string();

        assert_eq!(
            extract_cached_english_markdown(&raw, &sample_cache_source(), Some("de")).unwrap(),
            None
        );
    }

    #[test]
    fn test_matching_source_changed_translation_target_reuses_cache() {
        let source = sample_cache_source();
        let raw = build_summary_result_json(
            "# Reunion\n## Points\nBonjour",
            "# Meeting\n## Points\nHello",
            source.clone(),
            Some("fr"),
        )
        .to_string();

        assert_eq!(
            extract_cached_english_markdown(&raw, &source, Some("de")).unwrap(),
            Some("# Meeting\n## Points\nHello".to_string())
        );
    }

    #[test]
    fn test_same_language_regeneration_rejects_cache() {
        let source = sample_cache_source();
        let raw = build_summary_result_json(
            "# Reunion\n## Points\nBonjour",
            "# Meeting\n## Points\nHello",
            source.clone(),
            Some("fr"),
        )
        .to_string();

        assert_eq!(
            extract_cached_english_markdown(&raw, &source, Some("fr")).unwrap(),
            None
        );
    }

    #[test]
    fn test_changed_summary_inputs_reject_cache() {
        let source = sample_cache_source();
        let template_fingerprint = source.template_fingerprint.clone();
        let raw = build_summary_result_json(
            "# Reunion\n## Points\nBonjour",
            "# Meeting\n## Points\nHello",
            source,
            Some("fr"),
        )
        .to_string();

        let changed_sources = [
            build_summary_cache_source(
                "changed transcript",
                "custom prompt",
                "standard_meeting",
                &template_fingerprint,
                3700,
                "ollama",
                "gemma3:1b",
                Some("http://localhost:11434"),
                None,
                None,
                None,
                None,
            ),
            build_summary_cache_source(
                "transcript body",
                "changed prompt",
                "standard_meeting",
                &template_fingerprint,
                3700,
                "ollama",
                "gemma3:1b",
                Some("http://localhost:11434"),
                None,
                None,
                None,
                None,
            ),
            build_summary_cache_source(
                "transcript body",
                "custom prompt",
                "daily_standup",
                &template_fingerprint,
                3700,
                "ollama",
                "gemma3:1b",
                Some("http://localhost:11434"),
                None,
                None,
                None,
                None,
            ),
            build_summary_cache_source(
                "transcript body",
                "custom prompt",
                "standard_meeting",
                &template_fingerprint,
                3700,
                "openai",
                "gemma3:1b",
                Some("http://localhost:11434"),
                None,
                None,
                None,
                None,
            ),
            build_summary_cache_source(
                "transcript body",
                "custom prompt",
                "standard_meeting",
                &template_fingerprint,
                3700,
                "ollama",
                "qwen2.5:3b",
                Some("http://localhost:11434"),
                None,
                None,
                None,
                None,
            ),
            build_summary_cache_source(
                "transcript body",
                "custom prompt",
                "standard_meeting",
                &template_fingerprint,
                3700,
                "ollama",
                "gemma3:1b",
                Some("http://localhost:11500"),
                None,
                None,
                None,
                None,
            ),
            build_summary_cache_source(
                "transcript body",
                "custom prompt",
                "standard_meeting",
                &template_fingerprint,
                3700,
                "ollama",
                "gemma3:1b",
                Some("http://localhost:11434"),
                Some("https://custom.example/v1"),
                Some(2048),
                Some(0.2),
                Some(0.9),
            ),
        ];

        for changed_source in changed_sources {
            assert_eq!(
                extract_cached_english_markdown(&raw, &changed_source, Some("de")).unwrap(),
                None
            );
        }
    }

    #[test]
    fn test_changed_template_content_rejects_cache() {
        let source = sample_cache_source();
        let raw = build_summary_result_json(
            "# Reunion\n## Points\nBonjour",
            "# Meeting\n## Points\nHello",
            source.clone(),
            Some("fr"),
        )
        .to_string();

        let changed_template = SummaryCacheSource {
            template_fingerprint: stable_text_fingerprint("changed template prompt"),
            ..source
        };

        assert_eq!(
            extract_cached_english_markdown(&raw, &changed_template, Some("de")).unwrap(),
            None
        );
    }

    #[test]
    fn updated_report_rules_and_legacy_cache_require_regeneration() {
        let source = sample_cache_source();
        let mut cached = build_summary_result_json("Bonjour", "Hello", source.clone(), Some("fr"));
        assert_eq!(extract_cached_english_markdown(&cached.to_string(), &source, Some("de")).unwrap(), Some("Hello".into()));
        cached[ENGLISH_CACHE_FIELD]["source"]["report_instructions_fingerprint"] = serde_json::json!("old rules");
        assert_eq!(extract_cached_english_markdown(&cached.to_string(), &source, Some("de")).unwrap(), None);
        cached[ENGLISH_CACHE_FIELD]["source"].as_object_mut().unwrap().remove("report_instructions_fingerprint");
        assert_eq!(extract_cached_english_markdown(&cached.to_string(), &source, Some("de")).unwrap(), None);
    }

    #[test]
    fn test_changed_token_threshold_rejects_cache() {
        let source = sample_cache_source();
        let raw = build_summary_result_json(
            "# Reunion\n## Points\nBonjour",
            "# Meeting\n## Points\nHello",
            source.clone(),
            Some("fr"),
        )
        .to_string();

        let changed_threshold = SummaryCacheSource {
            token_threshold: 8192,
            ..source
        };

        assert_eq!(
            extract_cached_english_markdown(&raw, &changed_threshold, Some("de")).unwrap(),
            None
        );
    }

    #[test]
    fn test_result_json_strips_display_markdown_but_keeps_cache_title() {
        let result = build_summary_result_json(
            "# Translated Title\n## Decisions\nDone",
            "# English Title\n## Decisions\nDone",
            sample_cache_source(),
            Some("fr"),
        );

        assert_eq!(result["markdown"], "## Decisions\nDone");
        assert_eq!(
            result["english_cache"]["markdown"],
            "# English Title\n## Decisions\nDone"
        );
    }

    #[test]
    fn test_extract_cached_english_from_malformed_json_errors() {
        let raw = r#"{ not valid json"#;
        assert!(extract_cached_english_markdown(raw, &sample_cache_source(), Some("de")).is_err());
    }
}
