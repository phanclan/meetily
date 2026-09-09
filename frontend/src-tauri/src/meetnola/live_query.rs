use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;
use crate::summary::llm_client::{query_with_context, LLMProvider, MeetingExchange};
use reqwest::Client;
use tauri::{AppHandle, Manager, Runtime};
use tracing::info;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct QueryRequests(Mutex<HashMap<String, CancellationToken>>);

impl QueryRequests {
    fn prepare(&self) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.0.lock().unwrap().insert(id.clone(), CancellationToken::new());
        id
    }

    fn token(&self, id: &str) -> Result<CancellationToken, String> {
        self.0.lock().unwrap().get(id).cloned()
            .ok_or_else(|| "Meeting question was cancelled".to_string())
    }

    fn cancel(&self, id: &str) {
        if let Some(token) = self.0.lock().unwrap().remove(id) { token.cancel(); }
    }
}

// Register before dispatch so cancellation also works between IPC calls.
#[tauri::command]
pub fn prepare_live_query(requests: tauri::State<'_, QueryRequests>) -> String {
    requests.prepare()
}

#[tauri::command]
pub fn cancel_live_query(requests: tauri::State<'_, QueryRequests>, request_id: String) {
    requests.cancel(&request_id);
}

/// Answers a question using meeting sources and recent conversation for follow-up references.
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
    history: Option<Vec<MeetingExchange>>,
    request_id: String,
    requests: tauri::State<'_, QueryRequests>,
) -> Result<String, String> {
    let token = requests.token(&request_id)?;
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err("Meeting question was cancelled".to_string()),
        result = run_query(app, state, user_message, transcript_context, history, &token) => result,
    };
    requests.cancel(&request_id);
    result
}

async fn run_query<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    user_message: String,
    transcript_context: String,
    history: Option<Vec<MeetingExchange>>,
    token: &CancellationToken,
) -> Result<String, String> {
    info!("live_query called");
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
        history.as_deref().unwrap_or_default(),
        ollama_endpoint.as_deref(),
        custom_openai_endpoint.as_deref(),
        app_data_dir.as_ref(),
        Some(token),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_releases_only_the_target_request_even_before_dispatch() {
        let requests = QueryRequests::default();
        let first = requests.prepare();
        let second = requests.prepare();
        let running = requests.token(&first).unwrap();
        requests.cancel(&first);
        assert!(running.is_cancelled());
        assert!(requests.token(&first).is_err());
        assert!(!requests.token(&second).unwrap().is_cancelled());
        requests.cancel(&second);
        requests.cancel(&second);
        assert!(requests.0.lock().unwrap().is_empty());
    }
}
