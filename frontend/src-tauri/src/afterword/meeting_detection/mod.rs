//! Active meeting detection (OpenOats-inspired).
//!
//! Contract (port of OpenOats `MeetingDetector`, not a verbatim Swift translate):
//! - Watch media activity via CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere`
//!   on physical **input or output** devices. Never capture audio for detection.
//!   Output matters because a muted user can still hear remote participants — input
//!   alone misses those meetings (Teams often keeps `DeviceIsRunningSomewhere=false`
//!   on mics while speakers/Teams Audio output is active).
//! - Correlate with a known meeting app (bundle IDs via NSWorkspace; process-name
//!   fallback for MSTeams / Zoom when needed). Do **not** treat SlimCore / media-stack
//!   helpers alone as a start trigger (false positives when Teams loads its stack).
//! - **Media alone is not enough. App alone (idle) is not enough.**
//! - Additionally observe **in-meeting UI** (no audio capture):
//!   - Teams: window title contains `Meeting with` or `Meeting compact view`
//!   - Zoom: Accessibility menu bar item `Meeting` on `zoom.us` (fail soft if AX denied)
//! - Start = (`media` active for ~[`MEDIA_START_DEBOUNCE`] **OR** in-meeting UI)
//!   AND a known meeting app present.
//! - Hold / end: while in-meeting UI is present for the announced app, **do not** end
//!   on CoreAudio idle (meeting UI is stronger than media flaps). End when in-meeting
//!   UI is gone **and** (media idle for ~[`MEDIA_END_GRACE`] OR app exited). App exit
//!   still ends immediately.
//! - Prefer announcing an app that has in-meeting UI over static [`DISPLAY_PRIORITY`]
//!   (idle Teams must not steal a Zoom Meeting).
//! - While Afterword itself is recording, suppress prompts (skip poll; keep state).
//! - Enabling detection in Settings must not announce for apps that are open but
//!   whose media is idle **and** that lack in-meeting UI.
//!
//! Emits existing Tauri events `call-detected` / `call-ended`, and on Detected
//! shows a macOS notification with a Record action (`os_prompt`) **and** drives the
//! in-app CallDetectionBanner via `call-detected`.

mod os_prompt;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use tracing::{debug, info, warn};

/// How long media must stay active before we treat it as an in-call start signal.
const MEDIA_START_DEBOUNCE: Duration = Duration::from_secs(5);
/// Once in-call, how long media may stay idle before we end — if the meeting app
/// is still present **and** in-meeting UI is gone. Brief mute / mic drops should
/// not clear the prompt; meeting UI holds even longer.
const MEDIA_END_GRACE: Duration = Duration::from_secs(50);
/// Poll interval. OpenOats uses property listeners; polling is fine for status-only.
const POLL_INTERVAL: Duration = Duration::from_secs(3);

/// Display-name priority when multiple conferencing apps appear in the same poll
/// **without** differentiating in-meeting UI evidence.
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
/// Start: (`media_debounced_for_start` **OR** `in_meeting_ui`) **and** a meeting app.
///
/// End while in-call:
/// - meeting app gone → end immediately (even if media still "active" / UI stale)
/// - `in_meeting_ui` → stay (meeting UI outranks CoreAudio idle)
/// - media idle continuously for [`MEDIA_END_GRACE`] → end (app may still be open)
/// - otherwise stay active (covers mute / brief mic drops while app remains)
fn evaluate_transition(
    was_active: bool,
    media_debounced_for_start: bool,
    media_idle_for_end_grace: bool,
    meeting_app: Option<&str>,
    in_meeting_ui: bool,
) -> (bool, Option<DetectionEvent>) {
    if was_active {
        if meeting_app.is_none() {
            return (false, Some(DetectionEvent::Ended));
        }
        if in_meeting_ui {
            return (true, None);
        }
        if media_idle_for_end_grace {
            return (false, Some(DetectionEvent::Ended));
        }
        return (true, None);
    }

    let now_active = meeting_app.is_some() && (media_debounced_for_start || in_meeting_ui);
    if now_active {
        (
            true,
            Some(DetectionEvent::Detected(
                meeting_app.expect("now_active implies Some").to_string(),
            )),
        )
    } else {
        (false, None)
    }
}

/// Prefer apps with in-meeting UI evidence; otherwise fall back to [`DISPLAY_PRIORITY`].
fn pick_announced_app(
    apps: &HashSet<String>,
    in_meeting_ui_apps: &HashSet<String>,
) -> Option<String> {
    for &preferred in DISPLAY_PRIORITY {
        if in_meeting_ui_apps.contains(preferred) && apps.contains(preferred) {
            return Some(preferred.to_string());
        }
    }
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
/// Intentionally does **not** match SlimCore / ModuleHost — those load with the
/// Teams media stack even outside an active call and would false-positive starts.
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

/// Teams window title ⇒ in-call (case-insensitive).
fn teams_title_indicates_meeting(title: &str) -> bool {
    let folded = title.to_ascii_lowercase();
    folded.contains("meeting with") || folded.contains("meeting compact view")
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use cidre::core_audio::hardware::{Device, System};
    use cidre::core_audio::PropSelector;
    use cidre::ns;
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    /// True when any physical input **or** output device is running somewhere
    /// (status only — never opens a capture/playback stream for detection).
    pub fn any_media_device_running() -> bool {
        let devices = match System::devices() {
            Ok(d) => d,
            Err(e) => {
                warn!("meeting detection: CoreAudio device list failed: {e:?}");
                return false;
            }
        };

        for device in devices {
            if !(device_has_input(&device) || device_has_output(&device)) {
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

    fn device_has_output(device: &Device) -> bool {
        match device.output_stream_cfg() {
            Ok(cfg) => cfg.number_buffers() > 0,
            Err(_) => device.output_asbd().is_ok(),
        }
    }

    fn device_is_running_somewhere(device: &Device) -> bool {
        device
            .bool_prop(&PropSelector::DEVICE_IS_RUNNING_SOMEWHERE.global_addr())
            .unwrap_or(false)
    }

    /// All known meeting apps currently running (bundle ID, then process-name fallback).
    pub fn scan_meeting_apps() -> HashSet<String> {
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
            found.extend(scan_meeting_apps_by_process());
        }

        found
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

    /// Apps with live in-meeting UI evidence (window title / menu bar). No audio.
    /// Only probes apps that NSWorkspace already reported as running.
    pub fn scan_in_meeting_ui_apps(running_apps: &HashSet<String>) -> HashSet<String> {
        let mut found = HashSet::new();
        if running_apps.contains("Microsoft Teams") && teams_in_meeting_via_ui() {
            found.insert("Microsoft Teams".to_string());
        }
        if running_apps.contains("Zoom") && zoom_in_meeting_via_ui() {
            found.insert("Zoom".to_string());
        }
        found
    }

    /// Teams: any window title containing `Meeting with` or `Meeting compact view`.
    /// Uses System Events (Accessibility). Fail soft if AX denied / process missing.
    fn teams_in_meeting_via_ui() -> bool {
        // Return window titles; match in Rust via `teams_title_indicates_meeting`.
        let script = r#"
tell application "System Events"
  try
    if not (exists process "Microsoft Teams") then return ""
    set out to ""
    tell process "Microsoft Teams"
      repeat with w in windows
        set out to out & (name of w as text) & linefeed
      end repeat
    end tell
    return out
  on error
    return "err"
  end try
end tell
"#;
        match run_osascript(script) {
            Some(s) if s == "err" => {
                debug!("meeting detection: Teams System Events probe failed (AX denied?)");
                false
            }
            Some(s) => s.lines().any(teams_title_indicates_meeting),
            None => false,
        }
    }

    /// Zoom: menu bar item `Meeting` on process `zoom.us` (same signal Stream Deck uses).
    fn zoom_in_meeting_via_ui() -> bool {
        let script = r#"
tell application "System Events"
  try
    if not (exists process "zoom.us") then return "no"
    tell process "zoom.us"
      if exists menu bar item "Meeting" of menu bar 1 then
        return "yes"
      else
        return "no"
      end if
    end tell
  on error
    return "err"
  end try
end tell
"#;
        match run_osascript(script) {
            Some(s) if s == "yes" => true,
            Some(s) if s == "err" => {
                debug!("meeting detection: Zoom System Events probe failed (AX denied?)");
                false
            }
            _ => false,
        }
    }

    const OSASCRIPT_TIMEOUT: Duration = Duration::from_millis(400);

    fn run_osascript(script: &str) -> Option<String> {
        let mut child = match Command::new("osascript")
            .arg("-e")
            .arg(script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                debug!("meeting detection: osascript spawn failed: {e}");
                return None;
            }
        };

        let deadline = Instant::now() + OSASCRIPT_TIMEOUT;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let mut stdout = String::new();
                    if let Some(mut out) = child.stdout.take() {
                        let _ = out.read_to_string(&mut stdout);
                    }
                    if !status.success() {
                        debug!(
                            "meeting detection: osascript exited {:?}: {}",
                            status.code(),
                            {
                                let mut stderr = String::new();
                                if let Some(mut err) = child.stderr.take() {
                                    let _ = err.read_to_string(&mut stderr);
                                }
                                stderr.trim().to_string()
                            }
                        );
                        return None;
                    }
                    return Some(stdout.trim().to_string());
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    debug!("meeting detection: osascript timed out after {:?}", OSASCRIPT_TIMEOUT);
                    return None;
                }
                Err(e) => {
                    debug!("meeting detection: osascript wait failed: {e}");
                    return None;
                }
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;

    /// Active-meeting detection needs CoreAudio media status; unsupported here.
    pub fn any_media_device_running() -> bool {
        false
    }

    pub fn scan_meeting_apps() -> HashSet<String> {
        HashSet::new()
    }

    pub fn scan_in_meeting_ui_apps(_running_apps: &HashSet<String>) -> HashSet<String> {
        HashSet::new()
    }
}

#[cfg(target_os = "macos")]
use macos::{any_media_device_running, scan_in_meeting_ui_apps, scan_meeting_apps};
#[cfg(not(target_os = "macos"))]
use platform::{any_media_device_running, scan_in_meeting_ui_apps, scan_meeting_apps};

fn needs_in_meeting_ui_probe(apps: &HashSet<String>) -> bool {
    apps.contains("Microsoft Teams") || apps.contains("Zoom")
}

struct DetectionScan {
    apps: HashSet<String>,
    media_now: bool,
    in_meeting_ui_apps: HashSet<String>,
}

fn scan_detection_state(in_call: bool) -> DetectionScan {
    let apps = scan_meeting_apps();
    if apps.is_empty() && !in_call {
        return DetectionScan {
            apps,
            media_now: false,
            in_meeting_ui_apps: HashSet::new(),
        };
    }

    let media_now = any_media_device_running();
    let in_meeting_ui_apps = if needs_in_meeting_ui_probe(&apps) {
        scan_in_meeting_ui_apps(&apps)
    } else {
        HashSet::new()
    };

    DetectionScan {
        apps,
        media_now,
        in_meeting_ui_apps,
    }
}

/// Start the background poll loop. Emits `call-detected` / `call-ended` events.
///
/// Safe to call multiple times — subsequent calls are no-ops if already running.
pub fn start_detection<R: Runtime>(app: AppHandle<R>) {
    if DETECTION_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        info!(
            "Call detection started (media input|output + meeting app + in-meeting UI; start_debounce={:?}, end_grace={:?})",
            MEDIA_START_DEBOUNCE, MEDIA_END_GRACE
        );

        let mut in_call = false;
        let mut active_app: Option<String> = None;
        let mut media_active_since: Option<Instant> = None;
        let mut media_idle_since: Option<Instant> = None;

        loop {
            tokio::time::sleep(POLL_INTERVAL).await;

            if !DETECTION_ENABLED.load(Ordering::Relaxed) {
                media_active_since = None;
                media_idle_since = None;
                if in_call {
                    in_call = false;
                    active_app = None;
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

            let was_in_call = in_call;
            let scan = match tokio::task::spawn_blocking(move || scan_detection_state(was_in_call)).await
            {
                Ok(scan) => scan,
                Err(e) => {
                    warn!("meeting detection: scan task failed: {e}");
                    continue;
                }
            };
            let DetectionScan {
                apps,
                media_now,
                in_meeting_ui_apps,
            } = scan;

            if media_now {
                if media_active_since.is_none() {
                    media_active_since = Some(Instant::now());
                    debug!("meeting detection: media became active (start debounce)");
                }
                media_idle_since = None;
            } else {
                if media_active_since.take().is_some() {
                    debug!("meeting detection: media inactive (end grace may apply if in-call)");
                }
                if media_idle_since.is_none() {
                    media_idle_since = Some(Instant::now());
                }
            }

            let media_debounced = media_active_since
                .map(|t| t.elapsed() >= MEDIA_START_DEBOUNCE)
                .unwrap_or(false);

            let media_idle_for_grace = media_idle_since
                .map(|t| t.elapsed() >= MEDIA_END_GRACE)
                .unwrap_or(false);

            // While holding, evaluate against the announced app (not a newly preferred one).
            let (meeting_app, in_meeting_ui) = if in_call {
                match active_app.as_ref() {
                    Some(name) if apps.contains(name) => {
                        let ui = in_meeting_ui_apps.contains(name);
                        (Some(name.clone()), ui)
                    }
                    _ => (None, false), // announced app exited
                }
            } else {
                let picked = pick_announced_app(&apps, &in_meeting_ui_apps);
                let ui = picked
                    .as_ref()
                    .map(|n| in_meeting_ui_apps.contains(n))
                    .unwrap_or(false);
                (picked, ui)
            };

            // Explain misses: Teams/Zoom open but neither media nor in-meeting UI.
            if meeting_app.is_some() && !media_now && !in_meeting_ui && !in_call {
                debug!(
                    "meeting detection: meeting app present ({}) but media idle and no in-meeting UI",
                    meeting_app.as_deref().unwrap_or("?")
                );
            }

            let (next_active, event) = evaluate_transition(
                in_call,
                media_debounced,
                media_idle_for_grace,
                meeting_app.as_deref(),
                in_meeting_ui,
            );
            in_call = next_active;
            if !in_call {
                active_app = None;
            }

            match event {
                Some(DetectionEvent::Detected(name)) => {
                    let via = if in_meeting_ui {
                        "in-meeting UI"
                    } else {
                        "media debounced"
                    };
                    info!(
                        "Active meeting detected: {} ({} , app present)",
                        name, via
                    );
                    active_app = Some(name.clone());
                    // OS banner with Record action + frontend call-detected for in-app pill.
                    os_prompt::show_record_prompt(&app, &name);
                    let _ = app.emit(
                        "call-detected",
                        CallDetectedPayload { app_name: name },
                    );
                }
                Some(DetectionEvent::Ended) => {
                    info!(
                        "Active meeting ended (in-meeting UI gone and media idle past end grace, or meeting app gone)"
                    );
                    active_app = None;
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
    fn media_alone_or_app_alone_does_not_trigger() {
        assert_eq!(
            evaluate_transition(false, true, false, None, false),
            (false, None),
            "media without app"
        );
        assert_eq!(
            evaluate_transition(false, false, false, Some("Zoom"), false),
            (false, None),
            "app without media or in-meeting UI"
        );
        assert_eq!(
            evaluate_transition(false, false, true, Some("Zoom"), false),
            (false, None),
            "idle grace flag ignored when not yet in-call"
        );
    }

    #[test]
    fn media_debounced_and_app_triggers_detection() {
        assert_eq!(
            evaluate_transition(false, true, false, Some("Microsoft Teams"), false),
            (
                true,
                Some(DetectionEvent::Detected("Microsoft Teams".into()))
            )
        );
    }

    #[test]
    fn in_meeting_ui_and_app_triggers_without_media() {
        assert_eq!(
            evaluate_transition(false, false, false, Some("Microsoft Teams"), true),
            (
                true,
                Some(DetectionEvent::Detected("Microsoft Teams".into()))
            ),
            "Teams meeting window should start even when CoreAudio is idle"
        );
        assert_eq!(
            evaluate_transition(false, false, true, Some("Zoom"), true),
            (true, Some(DetectionEvent::Detected("Zoom".into()))),
            "Zoom Meeting menu should start even when media idle"
        );
    }

    #[test]
    fn stays_active_during_brief_media_idle_while_app_present() {
        // media_debounced_for_start=false, media_idle_for_end_grace=false → still in call
        assert_eq!(
            evaluate_transition(true, false, false, Some("Microsoft Teams"), false),
            (true, None),
            "mute / brief drop before end grace must not end"
        );
    }

    #[test]
    fn in_meeting_ui_holds_through_media_idle_past_grace() {
        assert_eq!(
            evaluate_transition(true, false, true, Some("Microsoft Teams"), true),
            (true, None),
            "meeting UI outranks CoreAudio idle past grace"
        );
    }

    #[test]
    fn ends_after_media_idle_grace_when_in_meeting_ui_gone() {
        assert_eq!(
            evaluate_transition(true, false, true, Some("Zoom"), false),
            (false, Some(DetectionEvent::Ended)),
            "media idle past end grace and no in-meeting UI"
        );
    }

    #[test]
    fn ends_immediately_when_meeting_app_exits() {
        assert_eq!(
            evaluate_transition(true, true, false, None, false),
            (false, Some(DetectionEvent::Ended)),
            "app gone ends even if media still looks active"
        );
        assert_eq!(
            evaluate_transition(true, false, false, None, true),
            (false, Some(DetectionEvent::Ended)),
            "app gone ends even if stale in_meeting_ui flag"
        );
        assert_eq!(
            evaluate_transition(true, false, true, None, false),
            (false, Some(DetectionEvent::Ended)),
            "app gone + grace elapsed still ends"
        );
    }

    #[test]
    fn stays_active_without_reemitting() {
        assert_eq!(
            evaluate_transition(true, true, false, Some("Zoom"), false),
            (true, None)
        );
        assert_eq!(
            evaluate_transition(true, false, false, Some("Zoom"), true),
            (true, None)
        );
    }

    #[test]
    fn end_grace_constants_are_in_expected_band() {
        assert_eq!(MEDIA_START_DEBOUNCE, Duration::from_secs(5));
        assert!(
            MEDIA_END_GRACE >= Duration::from_secs(45)
                && MEDIA_END_GRACE <= Duration::from_secs(60),
            "end grace should be ~45–60s, got {:?}",
            MEDIA_END_GRACE
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
    fn pick_announced_prefers_teams_over_slack_without_ui() {
        let apps: HashSet<String> = ["Slack".into(), "Microsoft Teams".into()]
            .into_iter()
            .collect();
        let ui = HashSet::new();
        assert_eq!(
            pick_announced_app(&apps, &ui).as_deref(),
            Some("Microsoft Teams")
        );
    }

    #[test]
    fn pick_announced_prefers_in_meeting_ui_over_display_priority() {
        let apps: HashSet<String> = ["Microsoft Teams".into(), "Zoom".into()]
            .into_iter()
            .collect();
        // Idle Teams would win DISPLAY_PRIORITY; Zoom Meeting must win instead.
        let ui: HashSet<String> = ["Zoom".into()].into_iter().collect();
        assert_eq!(pick_announced_app(&apps, &ui).as_deref(), Some("Zoom"));
    }

    #[test]
    fn teams_title_patterns_are_case_insensitive() {
        assert!(teams_title_indicates_meeting(
            "Meeting with Peter Phan | Microsoft Teams"
        ));
        assert!(teams_title_indicates_meeting(
            "Meeting compact view | Meeting with Peter Phan | Microsoft Teams"
        ));
        assert!(teams_title_indicates_meeting(
            "MEETING WITH alice | Microsoft Teams"
        ));
        assert!(!teams_title_indicates_meeting("Calendar | Microsoft Teams"));
        assert!(!teams_title_indicates_meeting("Chat | Microsoft Teams"));
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

    #[test]
    fn process_fallback_does_not_treat_slimcore_as_meeting_app() {
        assert_eq!(match_conferencing_app_process("SlimCore"), None);
        assert_eq!(
            match_conferencing_app_process("Microsoft Teams SlimCore ModuleHost"),
            // contains "Microsoft Teams" substring — ModuleHost process names that
            // embed the product string would still match; SlimCore alone must not.
            Some("Microsoft Teams")
        );
        assert_eq!(match_conferencing_app_process("ModuleHost"), None);
    }

    #[test]
    fn ui_probes_only_run_for_teams_or_zoom() {
        let idle: HashSet<String> = ["Slack".into(), "Discord".into()].into_iter().collect();
        assert!(!needs_in_meeting_ui_probe(&idle));
        let teams: HashSet<String> = ["Microsoft Teams".into()].into_iter().collect();
        assert!(needs_in_meeting_ui_probe(&teams));
        let zoom: HashSet<String> = ["Zoom".into()].into_iter().collect();
        assert!(needs_in_meeting_ui_probe(&zoom));
        assert!(!needs_in_meeting_ui_probe(&HashSet::new()));
    }
}
