use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Runtime};
use tracing::info;

/// Conferencing apps to watch for: (process name substring, display name)
const CONFERENCING_APPS: &[(&str, &str)] = &[
    ("zoom.us", "Zoom"),
    ("Microsoft Teams", "Microsoft Teams"),
    ("Slack", "Slack"),
    ("Discord", "Discord"),
    ("Webex", "Webex"),
    ("FaceTime", "FaceTime"),
    ("Google Meet", "Google Meet"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallDetectedPayload {
    pub app_name: String,
}

static DETECTION_RUNNING: AtomicBool = AtomicBool::new(false);
static DETECTION_ENABLED: AtomicBool = AtomicBool::new(false);

/// Returns the display name of the first detected conferencing app, if any.
fn detect_conferencing_app() -> Option<String> {
    let mut sys = System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for (needle, display_name) in CONFERENCING_APPS {
        for (_pid, proc_) in sys.processes() {
            let name = proc_.name().to_string_lossy();
            if name.contains(needle) {
                return Some(display_name.to_string());
            }
        }
    }
    None
}

/// Start the background poll loop. Emits `call-detected` / `call-ended` events.
/// Safe to call multiple times — subsequent calls are no-ops if already running.
pub fn start_detection<R: Runtime>(app: AppHandle<R>) {
    if DETECTION_RUNNING.swap(true, Ordering::SeqCst) {
        return; // Already running
    }

    tauri::async_runtime::spawn(async move {
        info!("Call detection started");
        let mut last_detected: Option<String> = None;

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;

            if !DETECTION_ENABLED.load(Ordering::Relaxed) {
                last_detected = None;
                continue;
            }

            // Skip detection while recording to avoid redundant banners
            if crate::audio::recording_commands::is_recording().await {
                if last_detected.is_some() {
                    last_detected = None;
                    let _ = app.emit("call-ended", ());
                }
                continue;
            }

            let detected = detect_conferencing_app();

            match (&last_detected, &detected) {
                (None, Some(name)) => {
                    info!("Conferencing app detected: {}", name);
                    let _ = app.emit(
                        "call-detected",
                        CallDetectedPayload {
                            app_name: name.clone(),
                        },
                    );
                    last_detected = detected;
                }
                (Some(_), None) => {
                    info!("Conferencing app closed");
                    let _ = app.emit("call-ended", ());
                    last_detected = None;
                }
                _ => {} // No change
            }
        }
    });
}

/// Stop detection (sets enabled=false; the loop still ticks but emits nothing).
#[tauri::command]
pub fn stop_call_detection() {
    DETECTION_ENABLED.store(false, Ordering::Relaxed);
    info!("Call detection disabled");
}

/// Re-enable detection.
#[tauri::command]
pub fn start_call_detection() {
    DETECTION_ENABLED.store(true, Ordering::Relaxed);
    info!("Call detection enabled");
}

/// Persist user preference and apply immediately.
#[tauri::command]
pub fn set_call_detection_enabled(enabled: bool) {
    DETECTION_ENABLED.store(enabled, Ordering::Relaxed);
    info!("Call detection set to: {}", enabled);
}

/// Returns whether detection is currently enabled.
#[tauri::command]
pub fn get_call_detection_enabled() -> bool {
    DETECTION_ENABLED.load(Ordering::Relaxed)
}
