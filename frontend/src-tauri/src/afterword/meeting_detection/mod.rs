//! Active meeting detection (OpenOats-inspired).
//!
//! Contract (port of OpenOats `MeetingDetector`, not a verbatim Swift translate):
//! - Watch mic status only via CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere`
//!   on physical **input** devices. Never capture audio for detection.
//! - Correlate with a known meeting app (bundle IDs via NSWorkspace; process-name
//!   fallback for MSTeams / Zoom when needed).
//! - **Mic alone is not enough. App alone is not enough.**
//! - Trigger = mic active for ~[`MIC_DEBOUNCE`] AND a known meeting app present.
//! - End when mic goes inactive or the meeting app exits.
//! - While Afterword itself is recording, suppress prompts (skip poll; keep state).
//! - Enabling detection in Settings must not announce for apps that are open but
//!   whose mic is idle.
//!
//! Emits existing Tauri events `call-detected` / `call-ended`, and on Detected
//! shows a macOS notification with a Record action (`os_prompt`).

mod os_prompt;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use tracing::{debug, info, warn};

/// How long the mic must stay active before we treat it as an in-call signal.
const MIC_DEBOUNCE: Duration = Duration::from_secs(5);
/// Poll interval. OpenOats uses property listeners; polling is fine for status-only.
const POLL_INTERVAL: Duration = Duration::from_secs(3);

/// Display-name priority when multiple conferencing apps appear in the same poll.
const DISPLAY_PRIORITY: &[&str] = &[
    "Microsoft Teams",
    "Zoom",
    "Slack",
    "Discord",
    "Webex",
    "FaceTime",
    "Google Meet",
    "WhatsApp",
    "Tuple",
    "Around",
];

/// Known meeting apps: bundle ID → display name (OpenOats meeting-apps.json + extras).
const KNOWN_MEETING_APPS: &[(&str, &str)] = &[
    ("us.zoom.xos", "Zoom"),
    ("com.microsoft.teams", "Microsoft Teams"),
    ("com.microsoft.teams2", "Microsoft Teams"),
    ("com.apple.FaceTime", "FaceTime"),
    ("com.cisco.webexmeetingsapp", "Webex"),
    ("app.tuple.app", "Tuple"),
    ("co.around.Around", "Around"),
    ("com.slack.Slack", "Slack"),
    ("com.hnc.Discord", "Discord"),
    ("net.whatsapp.WhatsApp", "WhatsApp"),
    (
        "com.google.Chrome.app.kjgfgldnnfobanmcafgkdilakhehfkbm",
        "Google Meet",
    ),
    ("ca.illusive.openphone", "OpenPhone"),
    ("com.infomaniak.meet", "kMeet"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallDetectedPayload {
    pub app_name: String,
}

static DETECTION_RUNNING: AtomicBool = AtomicBool::new(false);
static DETECTION_ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq, Eq)]
enum DetectionEvent {
    Detected(String),
    Ended,
}

/// Pure state transition used by the poll loop (and unit-tested).
///
/// `now_active` requires mic debounced **and** a meeting app display name.
fn evaluate_transition(
    was_active: bool,
    mic_debounced: bool,
    meeting_app: Option<&str>,
) -> (bool, Option<DetectionEvent>) {
    let now_active = mic_debounced && meeting_app.is_some();
    if now_active && !was_active {
        (
            true,
            Some(DetectionEvent::Detected(
                meeting_app.expect("now_active implies Some").to_string(),
            )),
        )
    } else if !now_active && was_active {
        (false, Some(DetectionEvent::Ended))
    } else {
        (now_active, None)
    }
}

fn pick_announced_app(apps: &HashSet<String>) -> Option<String> {
    for &preferred in DISPLAY_PRIORITY {
        if apps.contains(preferred) {
            return Some(preferred.to_string());
        }
    }
    apps.iter().next().cloned()
}

fn display_name_for_bundle_id(bundle_id: &str) -> Option<&'static str> {
    let folded = bundle_id.to_ascii_lowercase();
    KNOWN_MEETING_APPS
        .iter()
        .find(|(id, _)| id.eq_ignore_ascii_case(&folded))
        .map(|(_, name)| *name)
}

/// sysinfo may return a basename (`MSTeams`) or occasionally a full path — normalize.
fn process_basename(name: &str) -> &str {
    name.rsplit('/').next().unwrap_or(name)
}

/// Fragile process-name fallback when NSWorkspace bundle IDs are unavailable.
fn match_conferencing_app_process(name: &str) -> Option<&'static str> {
    let base = process_basename(name);

    if base.contains("crashpad") || base.contains("sdzoomplugin") {
        return None;
    }

    if base == "MSTeams" || base.contains("Microsoft Teams") {
        return Some("Microsoft Teams");
    }
    if base == "zoom.us" || base.contains("zoom.us") {
        return Some("Zoom");
    }
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

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use cidre::core_audio::hardware::{Device, System};
    use cidre::core_audio::PropSelector;
    use cidre::ns;

    /// True when any physical input device is running somewhere (status only).
    pub fn any_input_device_running() -> bool {
        let devices = match System::devices() {
            Ok(d) => d,
            Err(e) => {
                warn!("meeting detection: CoreAudio device list failed: {e:?}");
                return false;
            }
        };

        for device in devices {
            if !device_has_input(&device) {
                continue;
            }
            if device_is_running_somewhere(&device) {
                return true;
            }
        }
        false
    }

    fn device_has_input(device: &Device) -> bool {
        match device.input_stream_cfg() {
            Ok(cfg) => cfg.number_buffers() > 0,
            Err(_) => device.input_asbd().is_ok(),
        }
    }

    fn device_is_running_somewhere(device: &Device) -> bool {
        device
            .bool_prop(&PropSelector::DEVICE_IS_RUNNING_SOMEWHERE.global_addr())
            .unwrap_or(false)
    }

    /// Prefer NSWorkspace bundle IDs; fall back to process names for MSTeams/etc.
    pub fn scan_meeting_app() -> Option<String> {
        let mut found = HashSet::new();

        let apps = ns::Workspace::shared().running_apps();
        for i in 0..apps.len() {
            let Some(app) = apps.get(i).ok() else {
                continue;
            };
            let Some(bundle) = app.bundle_id() else {
                continue;
            };
            let bundle_str = bundle.to_string();
            if let Some(display) = display_name_for_bundle_id(&bundle_str) {
                found.insert(display.to_string());
            }
        }

        if found.is_empty() {
            // Process-name fallback (MSTeams helpers sometimes lack a stable bundle match).
            found.extend(scan_meeting_apps_by_process());
        }

        pick_announced_app(&found)
    }

    fn scan_meeting_apps_by_process() -> HashSet<String> {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System as SysInfo};

        let mut sys = SysInfo::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::new(),
        );

        let mut found = HashSet::new();
        for (_pid, proc_) in sys.processes() {
            let name = proc_.name().to_string_lossy();
            if let Some(display) = match_conferencing_app_process(&name) {
                found.insert(display.to_string());
            }
        }
        found
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    /// Active-meeting detection needs CoreAudio input status; unsupported here.
    pub fn any_input_device_running() -> bool {
        false
    }

    pub fn scan_meeting_app() -> Option<String> {
        None
    }
}

#[cfg(target_os = "macos")]
use macos::{any_input_device_running, scan_meeting_app};
#[cfg(not(target_os = "macos"))]
use platform::{any_input_device_running, scan_meeting_app};

/// Start the background poll loop. Emits `call-detected` / `call-ended` events.
///
/// Safe to call multiple times — subsequent calls are no-ops if already running.
pub fn start_detection<R: Runtime>(app: AppHandle<R>) {
    if DETECTION_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        info!(
            "Call detection started (OpenOats-style: mic + meeting app; debounce={:?})",
            MIC_DEBOUNCE
        );

        let mut in_call = false;
        let mut mic_active_since: Option<Instant> = None;

        loop {
            tokio::time::sleep(POLL_INTERVAL).await;

            if !DETECTION_ENABLED.load(Ordering::Relaxed) {
                mic_active_since = None;
                if in_call {
                    in_call = false;
                    info!("Call detection disabled — clearing active meeting");
                    os_prompt::invalidate_pending_prompts();
                    let _ = app.emit("call-ended", ());
                }
                continue;
            }

            // Skip while recording without treating the call as ended.
            if crate::audio::recording_commands::is_recording().await {
                continue;
            }

            let mic_now = any_input_device_running();
            if mic_now {
                if mic_active_since.is_none() {
                    mic_active_since = Some(Instant::now());
                    debug!("meeting detection: mic became active (debounce started)");
                }
            } else if mic_active_since.take().is_some() {
                debug!("meeting detection: mic inactive");
            }

            let mic_debounced = mic_active_since
                .map(|t| t.elapsed() >= MIC_DEBOUNCE)
                .unwrap_or(false);

            let meeting_app = scan_meeting_app();

            let (next_active, event) =
                evaluate_transition(in_call, mic_debounced, meeting_app.as_deref());
            in_call = next_active;

            match event {
                Some(DetectionEvent::Detected(name)) => {
                    info!(
                        "Active meeting detected: {} (mic debounced, app present)",
                        name
                    );
                    // OS banner with Record action (primary UX). Frontend still gets
                    // call-detected for state sync; in-app floating pill stays gated off.
                    os_prompt::show_record_prompt(&app, &name);
                    let _ = app.emit(
                        "call-detected",
                        CallDetectedPayload { app_name: name },
                    );
                }
                Some(DetectionEvent::Ended) => {
                    info!("Active meeting ended (mic idle or meeting app gone)");
                    os_prompt::invalidate_pending_prompts();
                    let _ = app.emit("call-ended", ());
                }
                None => {}
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mic_alone_or_app_alone_does_not_trigger() {
        assert_eq!(
            evaluate_transition(false, true, None),
            (false, None),
            "mic without app"
        );
        assert_eq!(
            evaluate_transition(false, false, Some("Zoom")),
            (false, None),
            "app without mic"
        );
    }

    #[test]
    fn mic_debounced_and_app_triggers_detection() {
        assert_eq!(
            evaluate_transition(false, true, Some("Microsoft Teams")),
            (
                true,
                Some(DetectionEvent::Detected("Microsoft Teams".into()))
            )
        );
    }

    #[test]
    fn ends_when_mic_drops_or_app_exits() {
        assert_eq!(
            evaluate_transition(true, false, Some("Zoom")),
            (false, Some(DetectionEvent::Ended)),
            "mic inactive"
        );
        assert_eq!(
            evaluate_transition(true, true, None),
            (false, Some(DetectionEvent::Ended)),
            "app gone"
        );
    }

    #[test]
    fn stays_active_without_reemitting() {
        assert_eq!(
            evaluate_transition(true, true, Some("Zoom")),
            (true, None)
        );
    }

    #[test]
    fn bundle_id_lookup_is_case_insensitive() {
        assert_eq!(
            display_name_for_bundle_id("COM.MICROSOFT.TEAMS2"),
            Some("Microsoft Teams")
        );
        assert_eq!(display_name_for_bundle_id("us.zoom.xos"), Some("Zoom"));
        assert_eq!(display_name_for_bundle_id("com.example.unknown"), None);
    }

    #[test]
    fn pick_announced_prefers_teams_over_slack() {
        let apps: HashSet<String> = ["Slack".into(), "Microsoft Teams".into()]
            .into_iter()
            .collect();
        assert_eq!(pick_announced_app(&apps).as_deref(), Some("Microsoft Teams"));
    }

    #[test]
    fn process_fallback_matches_msteams_binary() {
        assert_eq!(
            match_conferencing_app_process("MSTeams"),
            Some("Microsoft Teams")
        );
        assert_eq!(match_conferencing_app_process("zoom.us"), Some("Zoom"));
        assert_eq!(match_conferencing_app_process("Teams crashpad"), None);
    }
}
