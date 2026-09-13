use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Runtime};
use tracing::info;

/// Display-name priority when multiple conferencing apps appear in the same poll.
/// First match in this list wins for the `call-detected` payload.
const DISPLAY_PRIORITY: &[&str] = &[
    "Microsoft Teams",
    "Zoom",
    "Slack",
    "Discord",
    "Webex",
    "FaceTime",
    "Google Meet",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallDetectedPayload {
    pub app_name: String,
}

static DETECTION_RUNNING: AtomicBool = AtomicBool::new(false);
static DETECTION_ENABLED: AtomicBool = AtomicBool::new(false);

/// sysinfo may return a basename (`MSTeams`) or occasionally a full path — normalize.
fn process_basename(name: &str) -> &str {
    name.rsplit('/').next().unwrap_or(name)
}

/// Map a process name to a conferencing app display name.
/// Prefers main binaries (e.g. `MSTeams`, `zoom.us`, `Slack`) over crashpads / Stream Deck plugins.
fn match_conferencing_app(name: &str) -> Option<&'static str> {
    let base = process_basename(name);

    // Skip known non-call helpers / plugins even if they share a brand substring.
    if base.contains("crashpad") || base.contains("sdzoomplugin") {
        return None;
    }

    // New Teams (macOS) main binary is `MSTeams`; older builds / helpers use "Microsoft Teams*".
    // Do not match TeamsWidgetExtension / teams2 agent alone — those are not the call UI.
    if base == "MSTeams" || base.contains("Microsoft Teams") {
        return Some("Microsoft Teams");
    }

    // Zoom main binary; `zoom.us` does not match ZoomCefHelper or sdzoomplugin.
    if base == "zoom.us" || base.contains("zoom.us") {
        return Some("Zoom");
    }

    // Slack main + Electron helpers (`Slack Helper`, etc.)
    if base == "Slack" || base.starts_with("Slack ") {
        return Some("Slack");
    }

    if base.contains("Discord") {
        return Some("Discord");
    }
    if base.contains("Webex") {
        return Some("Webex");
    }
    if base == "FaceTime" || base.contains("FaceTime") {
        return Some("FaceTime");
    }
    if base.contains("Google Meet") {
        return Some("Google Meet");
    }

    None
}

/// Returns the set of conferencing apps currently running (by display name).
///
/// Takes the `System` so the caller can keep one across polls. Only process names
/// are read, so the refresh asks for nothing else: `System::new_all()` plus a full
/// refresh also collected CPU, memory, disk usage, env, and cwd for every process
/// on the machine, every 15 seconds, all of it discarded here.
fn detect_conferencing_apps(sys: &mut System) -> HashSet<String> {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new(),
    );

    let mut found = HashSet::new();
    for (_pid, proc_) in sys.processes() {
        let name = proc_.name().to_string_lossy();
        if let Some(display) = match_conferencing_app(&name) {
            found.insert(display.to_string());
        }
    }
    found
}

fn pick_announced_app(new_apps: &HashSet<String>) -> Option<String> {
    for &preferred in DISPLAY_PRIORITY {
        if new_apps.contains(preferred) {
            return Some(preferred.to_string());
        }
    }
    new_apps.iter().next().cloned()
}

/// Start the background poll loop. Emits `call-detected` / `call-ended` events.
///
/// Behavior:
/// - Polls every 15s while enabled and not recording.
/// - Tracks the *set* of detected conferencing apps.
/// - Emits `call-detected` when a new app appears that was not in the previous set
///   (so Teams starting while Zoom is already idle still notifies, with `app_name` = Teams).
/// - Emits `call-ended` when the set becomes empty (all watched apps gone).
/// - While recording, skips the poll without clearing `last_detected` and without
///   emitting `call-ended` (the same app after Stop is not a fresh detection).
/// - Safe to call multiple times — subsequent calls are no-ops if already running.
pub fn start_detection<R: Runtime>(app: AppHandle<R>) {
    if DETECTION_RUNNING.swap(true, Ordering::SeqCst) {
        return; // Already running
    }

    tauri::async_runtime::spawn(async move {
        info!("Call detection started");
        let mut last_detected: HashSet<String> = HashSet::new();
        let mut sys = System::new();

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;

            if !DETECTION_ENABLED.load(Ordering::Relaxed) {
                last_detected.clear();
                continue;
            }

            // Skip polling while recording without treating the call as ended.
            // Clearing last_detected here made Teams/Zoom look "new" after Stop.
            if crate::audio::recording_commands::is_recording().await {
                continue;
            }

            let detected = detect_conferencing_apps(&mut sys);

            let new_apps: HashSet<String> = detected
                .difference(&last_detected)
                .cloned()
                .collect();

            if let Some(name) = pick_announced_app(&new_apps) {
                info!(
                    "Conferencing app detected: {} (active: {:?})",
                    name, detected
                );
                let _ = app.emit(
                    "call-detected",
                    CallDetectedPayload {
                        app_name: name,
                    },
                );
            }

            if !last_detected.is_empty() && detected.is_empty() {
                info!("All conferencing apps closed");
                let _ = app.emit("call-ended", ());
            }

            last_detected = detected;
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
