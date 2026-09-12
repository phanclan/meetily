//! Afterword automation HTTP API — DEVELOPMENT ONLY.
//!
//! Gated by Cargo feature `afterword-automation` AND env `MEETILY_AUTOMATION=1`.
//! Binds to `127.0.0.1` only. Never enable in production/release tester without review.
//!
//! Security: all endpoints (including reads) require `Authorization: Bearer <token>`.
//! API keys are NEVER returned in responses (only `apiKeySet: bool`).

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::database::manager::DatabaseManager;
use crate::database::repositories::setting::SettingsRepository;

#[derive(Clone)]
pub struct AutomationState {
    pub db_manager: DatabaseManager,
    pub token: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    development_only: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TranscriptConfigPayload {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

#[derive(Serialize)]
struct TranscriptConfigResponse {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKeySet")]
    pub api_key_set: bool,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
}

fn check_auth(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == format!("Bearer {}", token))
        .unwrap_or(false)
}

fn unauthorized() -> (StatusCode, Json<ApiError>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(ApiError {
            error: "Missing or invalid Authorization header".to_string(),
        }),
    )
}

async fn health(
    State(state): State<Arc<AutomationState>>,
    headers: HeaderMap,
) -> Result<Json<HealthResponse>, (StatusCode, Json<ApiError>)> {
    if !check_auth(&headers, &state.token) {
        return Err(unauthorized());
    }
    Ok(Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        development_only: true,
    }))
}

async fn get_transcript_config(
    State(state): State<Arc<AutomationState>>,
    headers: HeaderMap,
) -> Result<Json<TranscriptConfigResponse>, (StatusCode, Json<ApiError>)> {
    if !check_auth(&headers, &state.token) {
        return Err(unauthorized());
    }

    let pool = state.db_manager.pool();

    let config = SettingsRepository::get_transcript_config(pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError { error: e.to_string() }),
            )
        })?;

    let (provider, model) = match config {
        Some(c) => (c.provider, c.model),
        None => (
            "parakeet".to_string(),
            crate::config::DEFAULT_PARAKEET_MODEL.to_string(),
        ),
    };

    let api_key_set = SettingsRepository::get_transcript_api_key(pool, &provider)
        .await
        .unwrap_or(None)
        .map(|k| !k.is_empty())
        .unwrap_or(false);

    Ok(Json(TranscriptConfigResponse {
        provider,
        model,
        api_key_set,
    }))
}

async fn put_transcript_config(
    State(state): State<Arc<AutomationState>>,
    headers: HeaderMap,
    Json(payload): Json<TranscriptConfigPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    if !check_auth(&headers, &state.token) {
        return Err(unauthorized());
    }

    let pool = state.db_manager.pool();

    SettingsRepository::save_transcript_config(pool, &payload.provider, &payload.model)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError {
                    error: format!("Failed to save config: {}", e),
                }),
            )
        })?;

    if let Some(key) = &payload.api_key {
        if !key.is_empty() {
            SettingsRepository::save_transcript_api_key(pool, &payload.provider, key)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ApiError {
                            error: format!("Failed to save API key: {}", e),
                        }),
                    )
                })?;
        }
    }

    let written = SettingsRepository::get_transcript_api_key(pool, &payload.provider)
        .await
        .unwrap_or(None);

    Ok(Json(serde_json::json!({
        "status": "ok",
        "provider": payload.provider,
        "model": payload.model,
        "apiKeySaved": written.as_ref().map(|k| !k.is_empty()).unwrap_or(false),
    })))
}

/// Start the automation HTTP server on the loopback interface.
/// Call only when feature `afterword-automation` is enabled and `MEETILY_AUTOMATION=1`.
pub async fn start(db_manager: DatabaseManager) {
    let port: u16 = std::env::var("MEETILY_AUTOMATION_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(21734);

    let token = std::env::var("MEETILY_AUTOMATION_TOKEN").unwrap_or_else(|_| {
        use rand::Rng;
        rand::thread_rng()
            .sample_iter(rand::distributions::Alphanumeric)
            .take(32)
            .map(char::from)
            .collect()
    });

    log::warn!(
        "[automation] DEVELOPMENT-ONLY server on http://127.0.0.1:{port} (MEETILY_AUTOMATION=1)"
    );
    log::warn!("[automation] token={token}");
    log::warn!(
        r#"[automation]   curl -H "Authorization: Bearer {token}" http://127.0.0.1:{port}/health"#
    );

    let state = Arc::new(AutomationState {
        db_manager,
        token,
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/config/transcript", get(get_transcript_config).put(put_transcript_config))
        .with_state(state);

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("[automation] Failed to bind {addr}: {e}"));

    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| panic!("[automation] Server error: {e}"));
}
