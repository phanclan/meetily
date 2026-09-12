use chrono::Utc;
use serde_json::Value;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub fn append_frontend_log<R: Runtime>(
    app: AppHandle<R>,
    level: String,
    message: String,
    metadata: Option<Value>,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let logs_dir = app_data_dir.join("logs");
    create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let log_path = logs_dir.join("frontend-runtime.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open frontend log file: {}", e))?;

    let timestamp = Utc::now().to_rfc3339();
    let metadata_json = metadata
        .map(|value| value.to_string())
        .unwrap_or_else(|| "{}".to_string());

    writeln!(
        file,
        "[{}] [{}] {} {}",
        timestamp, level, message, metadata_json
    )
    .map_err(|e| format!("Failed to write frontend log: {}", e))?;

    match level.as_str() {
        "error" => log::error!("[frontend] {} {}", message, metadata_json),
        "warn"  => log::warn!( "[frontend] {} {}", message, metadata_json),
        _       => log::info!( "[frontend] {} {}", message, metadata_json),
    }

    Ok(())
}
