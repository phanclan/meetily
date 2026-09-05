use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;
use crate::summary::llm_client::{query_with_context, LLMProvider};
use reqwest::Client;
use tauri::{AppHandle, Manager, Runtime};
use tracing::info;

/// Sends a single-shot question to the configured LLM using the live meeting transcript as context.
///
/// # Arguments
/// * `user_message` - The user's question or recipe prompt
/// * `transcript_context` - The current meeting transcript text
#[tauri::command]
pub async fn live_query<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    user_message: String,
    transcript_context: String,
) -> Result<String, String> {
    info!("live_query called: {}", &user_message[..user_message.len().min(80)]);
    let pool = state.db_manager.pool();

    // Load LLM settings
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to load model config: {}", e))?
        .ok_or_else(|| "LLM not configured. Please set up a model in Settings.".to_string())?;

    let provider = LLMProvider::from_str(&config.provider)?;

    // Retrieve API key (empty for Ollama / BuiltInAI / CustomOpenAI)
    let api_key = if provider == LLMProvider::Ollama
        || provider == LLMProvider::BuiltInAI
        || provider == LLMProvider::CustomOpenAI
    {
        String::new()
    } else {
        SettingsRepository::get_api_key(pool, &config.provider)
            .await
            .map_err(|e| format!("Failed to load API key: {}", e))?
            .filter(|k| !k.is_empty())
            .ok_or_else(|| {
                format!(
                    "API key not set for {}. Please add it in Settings.",
                    config.provider
                )
            })?
    };

    let ollama_endpoint = if provider == LLMProvider::Ollama {
        config.ollama_endpoint.as_deref().map(str::to_string)
    } else {
        None
    };

    let (custom_openai_endpoint, final_api_key) = if provider == LLMProvider::CustomOpenAI {
        let cfg = SettingsRepository::get_custom_openai_config(pool)
            .await
            .map_err(|e| format!("Failed to load custom OpenAI config: {}", e))?
            .ok_or_else(|| "Custom OpenAI provider selected but no configuration found".to_string())?;
        let key = cfg.api_key.unwrap_or_default();
        (Some(cfg.endpoint), key)
    } else {
        (None, api_key)
    };

    let app_data_dir = if provider == LLMProvider::BuiltInAI {
        Some(
            app.path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {}", e))?,
        )
    } else {
        None
    };

    let client = Client::new();

    query_with_context(
        &client,
        &provider,
        &config.model,
        &final_api_key,
        &transcript_context,
        &user_message,
        ollama_endpoint.as_deref(),
        custom_openai_endpoint.as_deref(),
        app_data_dir.as_ref(),
    )
    .await
}
