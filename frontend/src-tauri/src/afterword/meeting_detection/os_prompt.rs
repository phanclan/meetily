//! OpenOats-style desktop prompt: macOS notification with a Record action.
//!
//! Shown alongside the in-app CallDetectionBanner (`call-detected` event). Either
//! path can start recording via `request-recording-start`.

use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tracing::{info, warn};

/// Bumped on every new prompt / call-ended so a stale waiter cannot start recording
/// after the meeting (or a newer prompt) has already superseded it.
static PROMPT_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Invalidate any in-flight notification waiters (call ended, disabled, or replaced).
pub fn invalidate_pending_prompts() {
    PROMPT_GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// Show a system notification asking to record. Clicking Record (or the banner body)
/// emits `request-recording-start` — the same path as the tray / former in-app banner.
pub fn show_record_prompt<R: Runtime>(app: &AppHandle<R>, app_name: &str) {
    #[cfg(target_os = "macos")]
    {
        show_macos_record_prompt(app, app_name);
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Desktop notification plugins on non-macOS lack reliable action buttons.
        // Fall back to a plain banner; the frontend still listens for call-detected.
        let _ = app;
        let _ = app_name;
        warn!("Call-detection Record prompt is macOS-only; skipping OS notification actions");
    }
}

#[cfg(target_os = "macos")]
fn show_macos_record_prompt<R: Runtime>(app: &AppHandle<R>, app_name: &str) {
    let generation = PROMPT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app_handle = app.clone();
    let app_name = app_name.to_string();
    let bundle_id = app.config().identifier.clone();
    let body = format!("{} meeting. Record?", app_name);
    let title = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Afterword".to_string());

    // `mac_notification_sys::Notification::send` blocks until the user interacts
    // (or the notification is dismissed). Run it off the async runtime.
    let spawn_result = std::thread::Builder::new()
        .name("afterword-call-detect-notify".into())
        .spawn(move || {
            if let Err(error) = mac_notification_sys::set_application(&bundle_id) {
                // Already set by an earlier prompt / other notifier — still usable.
                info!(
                    "Call detection notification bundle id note ({}): {}",
                    bundle_id, error
                );
            }

            let response = mac_notification_sys::Notification::default()
                .title(title.as_str())
                .message(&body)
                .main_button(mac_notification_sys::MainButton::SingleAction("Record"))
                .wait_for_click(true)
                .send();

            if PROMPT_GENERATION.load(Ordering::SeqCst) != generation {
                info!("Ignoring stale call-detection notification response");
                return;
            }

            match response {
                Ok(mac_notification_sys::NotificationResponse::ActionButton(label))
                    if label.eq_ignore_ascii_case("Record") =>
                {
                    info!("Call detection Record action accepted for {}", app_name);
                    emit_start_recording(&app_handle);
                }
                Ok(mac_notification_sys::NotificationResponse::Click) => {
                    // Body click — treat as accept, matching OpenOats banner tap.
                    info!("Call detection notification clicked for {}", app_name);
                    emit_start_recording(&app_handle);
                }
                Ok(other) => {
                    info!("Call detection notification dismissed: {:?}", other);
                }
                Err(error) => {
                    warn!("Failed to show call detection notification: {}", error);
                }
            }
        });
    if let Err(error) = spawn_result {
        warn!(
            "Failed to spawn call detection notification thread: {}",
            error
        );
    }
}

#[cfg(target_os = "macos")]
fn emit_start_recording<R: Runtime>(app: &AppHandle<R>) {
    // Focus so the recording workspace route can mount listeners promptly.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    if let Err(error) = app.emit(
        "request-recording-start",
        serde_json::json!({ "source": "call_detection_notification" }),
    ) {
        warn!(
            "Failed to emit request-recording-start from call detection notification: {}",
            error
        );
    }
}
