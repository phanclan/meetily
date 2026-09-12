//! Afterword product defaults: local STT + Vercel AI Gateway for summaries/Enhance.
//!
//! Live transcription stays local (Parakeet). Summaries and Enhance use the existing
//! `custom-openai` transport pointed at the Vercel AI Gateway. Existing installs that
//! already chose Groq are left alone — these helpers only apply on missing/fresh config.

use crate::config::{DEFAULT_PARAKEET_MODEL, DEFAULT_WHISPER_MODEL};
use crate::database::repositories::setting::SettingsRepository;
use crate::summary::CustomOpenAIConfig;
use sqlx::SqlitePool;

/// Persisted summary provider string (existing CustomOpenAI transport).
pub const SUMMARY_PROVIDER: &str = "custom-openai";

/// Documented OpenAI-compatible model id on Vercel AI Gateway
/// (`GET https://ai-gateway.vercel.sh/v1/models`). Chosen as a cheap, capable
/// default for meeting summaries; users can change it in Settings.
pub const GATEWAY_MODEL: &str = "openai/gpt-5.6-luna";

/// OpenAI-compatible Chat Completions base URL for Vercel AI Gateway.
pub const GATEWAY_ENDPOINT: &str = "https://ai-gateway.vercel.sh/v1";

/// Live transcription: local Parakeet (not Groq/Gateway STT).
pub const TRANSCRIPT_PROVIDER: &str = "parakeet";

/// Default Parakeet model id (same catalog as Meetily local STT).
pub const TRANSCRIPT_MODEL: &str = DEFAULT_PARAKEET_MODEL;

/// Effective summary provider for Afterword feature builds.
#[allow(dead_code)]
pub fn summary_provider() -> &'static str {
    SUMMARY_PROVIDER
}

/// Effective summary model id for Afterword feature builds.
#[allow(dead_code)]
pub fn summary_model() -> &'static str {
    GATEWAY_MODEL
}

/// Effective live-transcription provider for Afterword feature builds.
#[allow(dead_code)]
pub fn transcript_provider() -> &'static str {
    TRANSCRIPT_PROVIDER
}

/// Effective live-transcription model for Afterword feature builds.
#[allow(dead_code)]
pub fn transcript_model() -> &'static str {
    TRANSCRIPT_MODEL
}

/// True when an endpoint is the Vercel AI Gateway base URL.
pub fn is_gateway_endpoint(endpoint: &str) -> bool {
    let trimmed = endpoint.trim().trim_end_matches('/');
    trimmed.eq_ignore_ascii_case(GATEWAY_ENDPOINT)
        || trimmed.eq_ignore_ascii_case("https://ai-gateway.vercel.sh/v1/")
}

/// Apply Afterword fresh-install / onboarding defaults atomically:
/// - transcript_settings → local Parakeet
/// - settings.provider/model → custom-openai + Gateway model
/// - settings.customOpenAIConfig → Gateway endpoint + model (no API key baked in)
///
/// Missing Gateway credentials must not block local recording; summary actions fail
/// cleanly later when the key is absent.
pub async fn apply_fresh_install_defaults(pool: &SqlitePool) -> Result<(), String> {
    SettingsRepository::save_transcript_config(pool, TRANSCRIPT_PROVIDER, TRANSCRIPT_MODEL)
        .await
        .map_err(|e| format!("Failed to set Afterword transcript defaults: {}", e))?;

    SettingsRepository::save_model_config(
        pool,
        SUMMARY_PROVIDER,
        GATEWAY_MODEL,
        DEFAULT_WHISPER_MODEL,
        None,
    )
    .await
    .map_err(|e| format!("Failed to set Afterword summary defaults: {}", e))?;

    let gateway_config = CustomOpenAIConfig {
        endpoint: GATEWAY_ENDPOINT.to_string(),
        api_key: None,
        model: GATEWAY_MODEL.to_string(),
        max_tokens: None,
        temperature: None,
        top_p: None,
    };

    SettingsRepository::save_custom_openai_config(pool, &gateway_config)
        .await
        .map_err(|e| format!("Failed to set Afterword Gateway config: {}", e))?;

    log::info!(
        "Applied Afterword defaults: transcript={}/{}, summary={}/{} @ {}",
        TRANSCRIPT_PROVIDER,
        TRANSCRIPT_MODEL,
        SUMMARY_PROVIDER,
        GATEWAY_MODEL,
        GATEWAY_ENDPOINT
    );

    Ok(())
}
