use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
// Removed unused import

// Performance optimization: Conditional logging macros for hot paths
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => {
        log::debug!($($arg)*)
    };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};
}

#[cfg(debug_assertions)]
macro_rules! perf_trace {
    ($($arg:tt)*) => {
        log::trace!($($arg)*)
    };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_trace {
    ($($arg:tt)*) => {};
}

// Make these macros available to other modules
#[allow(unused_imports)]
pub(crate) use perf_debug;
#[allow(unused_imports)]
pub(crate) use perf_trace;

// Re-export async logging macros for external use (removed due to macro conflicts)

// Declare audio module
pub mod analytics;
pub mod api;
mod app_quit;
pub mod audio;
pub mod config;
pub mod console_utils;
pub mod database;
#[cfg(feature = "afterword")]
mod afterword;
pub mod notifications;
pub mod ollama;
pub mod onboarding;
pub mod openai;
pub mod anthropic;
pub mod groq;
pub mod openrouter;
pub mod parakeet_engine;
pub mod state;
pub mod summary;
pub mod tray;
pub mod utils;
pub mod whisper_engine;
mod window_state;

use audio::{list_audio_devices, AudioDevice, trigger_audio_permission};
use log::{error as log_error, info as log_info};
use notifications::commands::NotificationManagerState;
use std::time::{Duration, Instant};
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Runtime, Size,
    WebviewWindow, WindowEvent,
};
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;

static RECORDING_FLAG: AtomicBool = AtomicBool::new(false);
static WINDOW_STATE_PERSIST_ENABLED: AtomicBool = AtomicBool::new(false);
static WINDOW_STATE_PERSIST_SEQ: AtomicU64 = AtomicU64::new(0);
static WINDOW_STATE_RESTORE_HOLDOFF_UNTIL: std::sync::LazyLock<StdMutex<Option<Instant>>> =
    std::sync::LazyLock::new(|| StdMutex::new(None));
const WINDOW_STATE_STORE: &str = "window-state.json";
const MAIN_WINDOW_STATE_KEY: &str = "main";
const WINDOW_STATE_PERSIST_DEBOUNCE: Duration = Duration::from_millis(250);
const WINDOW_STATE_RESTORE_HOLDOFF: Duration = Duration::from_millis(900);

// Global language preference storage (default to "auto-translate" for automatic translation to English)
static LANGUAGE_PREFERENCE: std::sync::LazyLock<StdMutex<String>> =
    std::sync::LazyLock::new(|| StdMutex::new("auto-translate".to_string()));

#[derive(Debug, Deserialize)]
struct RecordingArgs {
    save_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedWindowState {
    /// Physical pixel size from `inner_size` (not logical points).
    width: f64,
    height: f64,
    /// Optional outer position in physical pixels.
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    maximized: bool,
    /// Window scale when this frame was saved. Restore converts through the
    /// target monitor scale, not this value, so a 2x save is not replayed
    /// through a 1x window.
    #[serde(default)]
    scale_factor: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    version: String,
    build_id: String,
    channel: String,
    flavor: String,
    /// Which product the binary was actually compiled as, from the `afterword`
    /// Cargo feature. `flavor` above is only build metadata (an env var), so the
    /// two can disagree; the frontend asserts they match at startup.
    native_flavor: String,
    display_name: String,
}

#[tauri::command]
fn get_build_info() -> BuildInfo {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let build_id = env!("AFTERWORD_BUILD_ID").to_string();
    let channel = env!("AFTERWORD_BUILD_CHANNEL").to_string();
    let flavor = env!("AFTERWORD_BUILD_FLAVOR").to_string();
    let native_flavor = if cfg!(feature = "afterword") {
        "afterword".to_string()
    } else {
        "meetily".to_string()
    };

    let flavor_label = "Afterword";

    let display_name = format!("{} v{} ({}, {})", flavor_label, version, channel, build_id);

    BuildInfo {
        version,
        build_id,
        channel,
        flavor,
        native_flavor,
        display_name,
    }
}

fn load_main_window_state<R: Runtime>(app: &AppHandle<R>) -> Option<PersistedWindowState> {
    let store = app.store(WINDOW_STATE_STORE).ok()?;
    let value = store.get(MAIN_WINDOW_STATE_KEY)?;
    serde_json::from_value(value.clone()).ok()
}

fn persist_main_window_state<R: Runtime>(
    window: &WebviewWindow<R>,
    persist_while_hidden: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Ok(());
    }
    if !WINDOW_STATE_PERSIST_ENABLED.load(Ordering::SeqCst) {
        return Ok(());
    }
    // Moved/Resized can fire after tray hide with a junk/offscreen frame.
    // CloseRequested persists first (persist_while_hidden) so hide cannot
    // race the last visible inner size + outer position.
    if !persist_while_hidden && !window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    // Restoring a mixed-DPI frame is async. Any persist in that window still
    // reports the primary-display geometry and would overwrite the save.
    if in_restore_holdoff() {
        return Ok(());
    }
    if window.is_minimized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }

    let size = window
        .inner_size()
        .map_err(|e| format!("Failed to read window size: {}", e))?;
    if size.width == 0 || size.height == 0 {
        return Ok(());
    }

    // Prefer outer position so the frame returns to the same screen placement.
    // Overlay title bars: size stays inner/physical; position stays outer/physical.
    let position = window.outer_position().ok();
    let maximized = window.is_maximized().unwrap_or(false);
    let monitors = window_monitor_bounds(window);
    if !window_state::frame_is_persistable(
        size.width,
        size.height,
        position.map(|p| p.x),
        position.map(|p| p.y),
        maximized,
        &monitors,
    ) {
        log::debug!(
            "Skipping persist of implausible main window frame {}x{} at {:?}",
            size.width,
            size.height,
            position
        );
        return Ok(());
    }

    let state = PersistedWindowState {
        width: size.width as f64,
        height: size.height as f64,
        x: position.map(|p| p.x as f64),
        y: position.map(|p| p.y as f64),
        maximized,
        scale_factor: window.scale_factor().ok(),
    };

    let store = window
        .app_handle()
        .store(WINDOW_STATE_STORE)
        .map_err(|e| format!("Failed to access window state store: {}", e))?;

    let value = serde_json::to_value(state)
        .map_err(|e| format!("Failed to serialize window state: {}", e))?;
    store.set(MAIN_WINDOW_STATE_KEY, value);
    store
        .save()
        .map_err(|e| format!("Failed to save window state: {}", e))?;

    Ok(())
}

fn schedule_persist_main_window_state<R: Runtime>(window: &WebviewWindow<R>, immediate: bool) {
    if immediate {
        if let Err(e) = persist_main_window_state(window, false) {
            log::warn!("Failed to persist main window state: {}", e);
        }
        return;
    }

    let seq = WINDOW_STATE_PERSIST_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WINDOW_STATE_PERSIST_DEBOUNCE).await;
        if WINDOW_STATE_PERSIST_SEQ.load(Ordering::SeqCst) != seq {
            return;
        }
        if let Err(e) = persist_main_window_state(&window, false) {
            log::warn!("Failed to persist main window state: {}", e);
        }
    });
}

fn persist_then_hide_main_window<R: Runtime>(window: &WebviewWindow<R>) {
    // Invalidate in-flight Moved/Resized debounces so they cannot overwrite
    // this close-path save after hide.
    WINDOW_STATE_PERSIST_SEQ.fetch_add(1, Ordering::SeqCst);
    if let Err(e) = persist_main_window_state(window, true) {
        log::warn!("Failed to persist main window state before hide: {}", e);
    }
    if let Err(e) = window.hide() {
        log::error!("Failed to hide main window on close request: {}", e);
    } else {
        log::info!("Main window hidden to tray on close request");
    }
}

/// Final save before process exit (menu quit / tray quit / complete_app_quit).
/// Visible windows are captured here. If the window is already hidden to tray,
/// CloseRequested already wrote the last on-screen frame — do not replace it
/// with the hidden window's (often primary-display) geometry.
pub(crate) fn persist_main_window_before_quit<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        log::debug!("Skipping quit-time window persist; last visible frame already saved");
        return;
    }
    WINDOW_STATE_PERSIST_SEQ.fetch_add(1, Ordering::SeqCst);
    // Quit can race bootstrap; still try to capture the last visible frame.
    WINDOW_STATE_PERSIST_ENABLED.store(true, Ordering::SeqCst);
    if let Err(e) = persist_main_window_state(&window, true) {
        log::warn!("Failed to persist main window state before quit: {}", e);
    }
}

fn begin_restore_holdoff() {
    if let Ok(mut until) = WINDOW_STATE_RESTORE_HOLDOFF_UNTIL.lock() {
        *until = Some(Instant::now() + WINDOW_STATE_RESTORE_HOLDOFF);
    }
}

fn in_restore_holdoff() -> bool {
    WINDOW_STATE_RESTORE_HOLDOFF_UNTIL
        .lock()
        .ok()
        .and_then(|until| *until)
        .is_some_and(|deadline| Instant::now() < deadline)
}

fn enable_main_window_state_persist<R: Runtime>(window: &WebviewWindow<R>) {
    WINDOW_STATE_PERSIST_ENABLED.store(true, Ordering::SeqCst);
    // Do not persist immediately: restore has not finished applying, and a
    // premature save would store the default primary-display frame.
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WINDOW_STATE_RESTORE_HOLDOFF + Duration::from_millis(100)).await;
        if let Err(e) = persist_main_window_state(&window, false) {
            log::warn!("Failed to persist main window state after restore: {}", e);
        }
    });
}

fn restore_main_window_state<R: Runtime>(window: &WebviewWindow<R>) {
    let Some(state) = load_main_window_state(&window.app_handle()) else {
        return;
    };

    begin_restore_holdoff();

    let monitors = window_monitor_bounds(window);
    let primary = primary_monitor_bounds(window, &monitors);
    log::info!(
        "Restoring main window {}x{} at {:?},{:?} (saved scale {:?}) with {} monitor(s)",
        state.width,
        state.height,
        state.x,
        state.y,
        state.scale_factor,
        monitors.len()
    );
    if let Some(frame) = window_state::sanitize_restored_frame(
        state.width,
        state.height,
        state.x,
        state.y,
        &monitors,
        primary,
    ) {
        if state.width.round() as u32 != frame.width
            || state.height.round() as u32 != frame.height
            || state.x.map(|x| x.round() as i32) != Some(frame.x)
            || state.y.map(|y| y.round() as i32) != Some(frame.y)
        {
            log::info!(
                "Clamped restored main window from {}x{} at {:?},{:?} to {}x{} at {},{}",
                state.width,
                state.height,
                state.x,
                state.y,
                frame.width,
                frame.height,
                frame.x,
                frame.y
            );
        }
        if !state.maximized {
            if let Err(e) = window.unmaximize() {
                log::debug!("Failed to unmaximize before restore: {}", e);
            }
        }
        apply_window_frame(window, frame);
    } else if !state.maximized {
        log::warn!("Skipping main window restore; no usable display geometry");
    }

    if state.maximized {
        if let Err(e) = window.maximize() {
            log::warn!("Failed to restore maximized window state: {}", e);
        }
    }
}

fn ensure_main_window_frame_is_sane<R: Runtime>(window: &WebviewWindow<R>) {
    let Ok(size) = window.inner_size() else {
        return;
    };
    let position = window.outer_position().ok();
    let Some(origin) = position else {
        return;
    };
    let monitors = window_monitor_bounds(window);
    let current = window_state::WindowFrame {
        width: size.width,
        height: size.height,
        x: origin.x,
        y: origin.y,
        scale_factor: window.scale_factor().unwrap_or(1.0),
    };
    if !window_state::frame_needs_correction(current, &monitors) {
        return;
    }

    let primary = primary_monitor_bounds(window, &monitors);
    if let Some(frame) = window_state::sanitize_restored_frame(
        size.width as f64,
        size.height as f64,
        Some(origin.x as f64),
        Some(origin.y as f64),
        &monitors,
        primary,
    ) {
        log::info!(
            "Corrected on-screen main window from {}x{} at {},{} to {}x{} at {},{}",
            current.width,
            current.height,
            current.x,
            current.y,
            frame.width,
            frame.height,
            frame.x,
            frame.y
        );
        apply_window_frame(window, frame);
    }
}

fn apply_window_frame<R: Runtime>(window: &WebviewWindow<R>, frame: window_state::WindowFrame) {
    let (logical_w, logical_h) = frame.logical_size();
    let (logical_x, logical_y) = frame.logical_position();
    log::info!(
        "Applying main window frame {}x{} at {},{} as logical {:.1}x{:.1} at {:.1},{:.1} (scale {:.2})",
        frame.width,
        frame.height,
        frame.x,
        frame.y,
        logical_w,
        logical_h,
        logical_x,
        logical_y,
        frame.scale_factor
    );
    // Logical points are scale-independent. Physical set_size/set_position are
    // converted with the *current* window scale, so a 2x-display save applied
    // while the window still sits on a 1x primary lands off every screen.
    if let Err(e) = window.set_size(Size::Logical(LogicalSize::new(logical_w, logical_h))) {
        log::warn!("Failed to restore main window size: {}", e);
    }
    if let Err(e) = window.set_position(Position::Logical(LogicalPosition::new(logical_x, logical_y)))
    {
        log::warn!("Failed to restore main window position: {}", e);
    }
}

fn schedule_restore_retries<R: Runtime>(window: &WebviewWindow<R>) {
    if load_main_window_state(&window.app_handle()).is_none() {
        return;
    }
    for delay_ms in [50_u64, 400] {
        let window = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            restore_main_window_state(&window);
            if delay_ms == 400 {
                ensure_main_window_frame_is_sane(&window);
            }
        });
    }
}

fn window_monitor_bounds<R: Runtime>(window: &WebviewWindow<R>) -> Vec<window_state::MonitorBounds> {
    window
        .available_monitors()
        .ok()
        .unwrap_or_default()
        .iter()
        .map(monitor_to_bounds)
        .filter(|monitor| monitor.width > 0 && monitor.height > 0)
        .collect()
}

fn primary_monitor_bounds<R: Runtime>(
    window: &WebviewWindow<R>,
    fallback: &[window_state::MonitorBounds],
) -> Option<window_state::MonitorBounds> {
    window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor_to_bounds(&monitor))
        .filter(|monitor| monitor.width > 0 && monitor.height > 0)
        .or_else(|| fallback.first().copied())
}

fn monitor_to_bounds(monitor: &tauri::Monitor) -> window_state::MonitorBounds {
    let work = monitor.work_area();
    window_state::MonitorBounds {
        x: work.position.x,
        y: work.position.y,
        width: work.size.width,
        height: work.size.height,
        scale_factor: monitor.scale_factor(),
    }
}

#[tauri::command]
fn frontend_bootstrap_complete<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.state::<app_quit::QuitCoordinator>().frontend_ready();
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    match window.is_visible() {
        Ok(true) => {}
        Ok(false) => {
            window
                .show()
                .map_err(|e| format!("Failed to show main window: {}", e))?;
        }
        Err(e) => {
            return Err(format!("Failed to inspect main window visibility: {}", e));
        }
    }

    // Monitors are usually fully enumerated by the time the frontend is ready.
    // Re-apply saved state as logical points so a mixed-DPI side display is not
    // interpreted with the primary's scale. AppKit applies setFrame async, so
    // retry shortly after show.
    restore_main_window_state(&window);
    schedule_restore_retries(&window);
    enable_main_window_state_persist(&window);

    if let Err(e) = window.set_focus() {
        log::warn!("Failed to focus main window after frontend bootstrap: {}", e);
    }

    let app_for_preload = app.clone();
    tauri::async_runtime::spawn(async move {
        audio::transcription::preload_transcription_model(&app_for_preload).await;
    });

    Ok(())
}


#[tauri::command]
async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    log_info!("🔥 CALLED start_recording with meeting: {:?}", meeting_name);
    log_info!(
        "📋 Backend received parameters - mic: {:?}, system: {:?}, meeting: {:?}",
        mic_device_name,
        system_device_name,
        meeting_name
    );

    if is_recording().await {
        return Err("Recording already in progress".to_string());
    }

    // Call the actual audio recording system with meeting name
    match audio::recording_commands::start_recording_with_devices_and_meeting(
        app.clone(),
        mic_device_name,
        system_device_name,
        meeting_name.clone(),
    )
    .await
    {
        Ok(_) => {
            RECORDING_FLAG.store(true, Ordering::SeqCst);
            tray::update_tray_menu(&app);

            log_info!("Recording started successfully");

            // Show recording started notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_started_notification(
                &app,
                &notification_manager_state,
                meeting_name.clone(),
            )
            .await
            {
                log_error!(
                    "Failed to show recording started notification: {}",
                    e
                );
            } else {
                log_info!("Successfully showed recording started notification");
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to start audio recording: {}", e);
            Err(format!("Failed to start recording: {}", e))
        }
    }
}

#[tauri::command]
async fn stop_recording<R: Runtime>(
    app: AppHandle<R>,
    args: RecordingArgs,
) -> Result<audio::recording_commands::StopRecordingResult, String> {
    log_info!("Attempting to stop recording...");

    // Check the actual audio recording system state instead of the flag
    if !audio::recording_commands::is_recording().await {
        log_info!("Recording is already stopped");
        return Ok(audio::recording_commands::StopRecordingResult::complete(
            "Recording was already stopped",
        ));
    }

    // Call the actual audio recording system to stop
    match audio::recording_commands::stop_recording(
        app.clone(),
        audio::recording_commands::RecordingArgs {
            save_path: args.save_path.clone(),
        },
    )
    .await
    {
        Ok(stop_result) => {
            RECORDING_FLAG.store(false, Ordering::SeqCst);
            tray::update_tray_menu(&app);

            // Create the save directory if it doesn't exist
            if let Some(parent) = std::path::Path::new(&args.save_path).parent() {
                if !parent.exists() {
                    log_info!("Creating directory: {:?}", parent);
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        let err_msg = format!("Failed to create save directory: {}", e);
                        log_error!("{}", err_msg);
                        return Err(err_msg);
                    }
                }
            }

            // Show recording stopped notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_stopped_notification(
                &app,
                &notification_manager_state,
            )
            .await
            {
                log_error!(
                    "Failed to show recording stopped notification: {}",
                    e
                );
            } else {
                log_info!("Successfully showed recording stopped notification");
            }

            Ok(stop_result)
        }
        Err(e) => {
            log_error!("Failed to stop audio recording: {}", e);
            // Still update the flag even if stopping failed
            RECORDING_FLAG.store(false, Ordering::SeqCst);
            tray::update_tray_menu(&app);
            Err(format!("Failed to stop recording: {}", e))
        }
    }
}

#[tauri::command]
async fn is_recording() -> bool {
    audio::recording_commands::is_recording().await
}

#[tauri::command]
async fn get_transcription_status() -> audio::recording_commands::TranscriptionStatus {
    audio::recording_commands::get_transcription_status().await
}

#[tauri::command]
fn read_audio_file(file_path: String) -> Result<Vec<u8>, String> {
    match std::fs::read(&file_path) {
        Ok(data) => Ok(data),
        Err(e) => Err(format!("Failed to read audio file: {}", e)),
    }
}

#[tauri::command]
async fn save_transcript(file_path: String, content: String) -> Result<(), String> {
    log_info!("Saving transcript to: {}", file_path);

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }

    // Write content to file
    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write transcript: {}", e))?;

    log_info!("Transcript saved successfully");
    Ok(())
}

// Audio level monitoring commands
#[tauri::command]
async fn start_audio_level_monitoring<R: Runtime>(
    app: AppHandle<R>,
    device_names: Vec<String>,
) -> Result<(), String> {
    log_info!(
        "Starting audio level monitoring for devices: {:?}",
        device_names
    );

    audio::simple_level_monitor::start_monitoring(app, device_names)
        .await
        .map_err(|e| format!("Failed to start audio level monitoring: {}", e))
}

#[tauri::command]
async fn stop_audio_level_monitoring() -> Result<(), String> {
    log_info!("Stopping audio level monitoring");

    audio::simple_level_monitor::stop_monitoring()
        .await
        .map_err(|e| format!("Failed to stop audio level monitoring: {}", e))
}

#[tauri::command]
async fn is_audio_level_monitoring() -> bool {
    audio::simple_level_monitor::is_monitoring()
}

// Analytics commands are now handled by analytics::commands module

// Whisper commands are now handled by whisper_engine::commands module

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<AudioDevice>, String> {
    list_audio_devices()
        .await
        .map_err(|e| format!("Failed to list audio devices: {}", e))
}

#[tauri::command]
async fn trigger_microphone_permission() -> Result<bool, String> {
    trigger_audio_permission()
        .map_err(|e| format!("Failed to trigger microphone permission: {}", e))
}

#[tauri::command]
async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start_recording_with_devices_and_meeting(app, mic_device_name, system_device_name, None).await
}

#[tauri::command]
async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    log_info!("🚀 CALLED start_recording_with_devices_and_meeting - Mic: {:?}, System: {:?}, Meeting: {:?}",
             mic_device_name, system_device_name, meeting_name);

    // Clone meeting_name for notification use later
    let meeting_name_for_notification = meeting_name.clone();

    // Call the recording module functions that support meeting names
    let recording_result = match (mic_device_name.clone(), system_device_name.clone()) {
        (None, None) => {
            log_info!(
                "No devices specified, starting with defaults and meeting: {:?}",
                meeting_name
            );
            audio::recording_commands::start_recording_with_meeting_name(app.clone(), meeting_name)
                .await
        }
        _ => {
            log_info!(
                "Starting with specified devices: mic={:?}, system={:?}, meeting={:?}",
                mic_device_name,
                system_device_name,
                meeting_name
            );
            audio::recording_commands::start_recording_with_devices_and_meeting(
                app.clone(),
                mic_device_name,
                system_device_name,
                meeting_name,
            )
            .await
        }
    };

    match recording_result {
        Ok(_) => {
            log_info!("Recording started successfully via tauri command");

            // Show recording started notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_started_notification(
                &app,
                &notification_manager_state,
                meeting_name_for_notification.clone(),
            )
            .await
            {
                log_error!(
                    "Failed to show recording started notification: {}",
                    e
                );
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to start recording via tauri command: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
async fn set_language_preference(language: String) -> Result<(), String> {
    let mut lang_pref = LANGUAGE_PREFERENCE
        .lock()
        .map_err(|e| format!("Failed to set language preference: {}", e))?;
    log_info!("Setting language preference to: {}", language);
    *lang_pref = language;
    Ok(())
}

#[tauri::command]
async fn request_recording_start<R: Runtime>(
    app: AppHandle<R>,
    source: Option<String>,
) -> Result<(), String> {
    let source = source.unwrap_or_else(|| "unknown".to_string());

    app.emit(
        "request-recording-start",
        serde_json::json!({ "source": source }),
    )
    .map_err(|e| e.to_string())
}

// Internal helper function to get language preference (for use within Rust code)
pub fn get_language_preference_internal() -> Option<String> {
    LANGUAGE_PREFERENCE.lock().ok().map(|lang| lang.clone())
}

pub fn run() {
    log::set_max_level(log::LevelFilter::Info);

    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            log_info!(
                "Second app instance requested with args: {:?}, cwd: {:?}",
                args,
                cwd
            );

            tray::focus_main_window(app);
        }));
    }

    #[cfg(feature = "afterword")]
    {
        builder = builder.plugin(afterword::init());
    }

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(whisper_engine::parallel_commands::ParallelProcessorState::new())
        .manage(Arc::new(RwLock::new(
            None::<notifications::manager::NotificationManager<tauri::Wry>>,
        )) as NotificationManagerState<tauri::Wry>)
        .manage(state::MeetingSessionState::default())
        .manage(app_quit::QuitCoordinator::default())
        .manage(audio::init_system_audio_state())
        .manage(summary::summary_engine::ModelManagerState(Arc::new(tokio::sync::Mutex::new(None))))
        .setup(|_app| {
            log::info!("Application setup complete");

            if let Some(window) = _app.get_webview_window("main") {
                restore_main_window_state(&window);
                // Always retry: secondary displays and mixed-DPI scale can be
                // missing or wrong during the first hidden restore.
                schedule_restore_retries(&window);

                let window_for_bootstrap_timeout = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(15)).await;

                    match window_for_bootstrap_timeout.is_visible() {
                        Ok(true) => {}
                        Ok(false) => {
                            log::warn!(
                                "Frontend bootstrap did not complete within 15s; showing main window as fallback"
                            );
                            if let Err(e) = window_for_bootstrap_timeout.show() {
                                log::warn!("Failed to show fallback main window: {}", e);
                            }
                            restore_main_window_state(&window_for_bootstrap_timeout);
                            enable_main_window_state_persist(&window_for_bootstrap_timeout);
                        }
                        Err(e) => {
                            log::warn!("Failed to inspect fallback main window visibility: {}", e);
                        }
                    }
                });

                let window_for_events = window.clone();
                window.on_window_event(move |event| {
                    match event {
                        WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                            schedule_persist_main_window_state(&window_for_events, false);
                        }
                        WindowEvent::Destroyed => {
                            schedule_persist_main_window_state(&window_for_events, true);
                        }
                        _ => {}
                    }
                });
            }

            // Initialize system tray
            if let Err(e) = tray::create_tray(_app.handle()) {
                log::error!("Failed to create system tray: {}", e);
            }

            // Initialize notification system with proper defaults
            log::info!("Initializing notification system...");
            let app_for_notif = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let notif_state = app_for_notif.state::<NotificationManagerState<tauri::Wry>>();
                match notifications::commands::initialize_notification_manager(app_for_notif.clone()).await {
                    Ok(manager) => {
                        // Set default consent and permissions on first launch
                        if let Err(e) = manager.set_consent(true).await {
                            log::error!("Failed to set initial consent: {}", e);
                        }
                        if let Err(e) = manager.request_permission().await {
                            log::error!("Failed to request initial permission: {}", e);
                        }

                        // Store the initialized manager
                        let mut state_lock = notif_state.write().await;
                        *state_lock = Some(manager);
                        log::info!("Notification system initialized with default permissions");
                    }
                    Err(e) => {
                        log::error!("Failed to initialize notification manager: {}", e);
                    }
                }
            });

            // Set models directory to use app_data_dir (unified storage location)
            whisper_engine::commands::set_models_directory(&_app.handle());

            // Initialize Whisper engine on startup
            tauri::async_runtime::spawn(async {
                if let Err(e) = whisper_engine::commands::whisper_init().await {
                    log::error!("Failed to initialize Whisper engine on startup: {}", e);
                }
            });

            // Set Parakeet models directory
            parakeet_engine::commands::set_models_directory(&_app.handle());

            // Initialize Parakeet engine on startup
            tauri::async_runtime::spawn(async {
                if let Err(e) = parakeet_engine::commands::parakeet_init().await {
                    log::error!("Failed to initialize Parakeet engine on startup: {}", e);
                }
            });

            // Initialize ModelManager for summary engine (async, non-blocking)
            let app_handle_for_model_manager = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match summary::summary_engine::commands::init_model_manager_at_startup(&app_handle_for_model_manager).await {
                    Ok(_) => log::info!("ModelManager initialized successfully at startup"),
                    Err(e) => {
                        log::warn!("Failed to initialize ModelManager at startup: {}", e);
                        log::warn!("ModelManager will be lazy-initialized on first use");
                    }
                }
            });

            // Trigger system audio permission request on startup (similar to microphone permission)
            // #[cfg(target_os = "macos")]
            // {
            //     tauri::async_runtime::spawn(async {
            //         if let Err(e) = audio::permissions::trigger_system_audio_permission() {
            //             log::warn!("Failed to trigger system audio permission: {}", e);
            //         }
            //     });
            // }

            // Initialize database (handles first launch detection and conditional setup)
            tauri::async_runtime::block_on(async {
                database::setup::initialize_database_on_startup(&_app.handle()).await
            })
            .expect("Failed to initialize database");

            // Initialize bundled templates directory for dynamic template discovery
            log::info!("Initializing bundled templates directory...");
            if let Ok(resource_path) = _app.handle().path().resource_dir() {
                let templates_dir = resource_path.join("templates");
                log::info!("Setting bundled templates directory to: {:?}", templates_dir);
                summary::templates::set_bundled_templates_dir(templates_dir);
            } else {
                log::warn!("Failed to resolve resource directory for templates");
            }

            // Afterword lifecycle (call detection + optional automation HTTP API)
            #[cfg(feature = "afterword")]
            afterword::start_after_database(_app.handle());

            #[cfg(target_os = "macos")]
            app_quit::install_quit_menu(_app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    match window.app_handle().get_webview_window("main") {
                        Some(main) => persist_then_hide_main_window(&main),
                        None => {
                            if let Err(e) = window.hide() {
                                log::error!(
                                    "Failed to hide main window on close request: {}",
                                    e
                                );
                            }
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            is_recording,
            get_transcription_status,
            read_audio_file,
            save_transcript,
            analytics::commands::init_analytics,
            analytics::commands::disable_analytics,
            analytics::commands::track_event,
            analytics::commands::identify_user,
            analytics::commands::track_meeting_started,
            analytics::commands::track_recording_started,
            analytics::commands::track_recording_stopped,
            analytics::commands::track_meeting_deleted,
            analytics::commands::track_settings_changed,
            analytics::commands::track_feature_used,
            analytics::commands::is_analytics_enabled,
            analytics::commands::start_analytics_session,
            analytics::commands::end_analytics_session,
            analytics::commands::track_daily_active_user,
            analytics::commands::track_user_first_launch,
            analytics::commands::is_analytics_session_active,
            analytics::commands::track_summary_generation_started,
            analytics::commands::track_summary_generation_completed,
            analytics::commands::track_summary_regenerated,
            analytics::commands::track_model_changed,
            analytics::commands::track_custom_prompt_used,
            analytics::commands::track_meeting_ended,
            analytics::commands::track_analytics_enabled,
            analytics::commands::track_analytics_disabled,
            analytics::commands::track_analytics_transparency_viewed,
            whisper_engine::commands::whisper_init,
            whisper_engine::commands::whisper_get_available_models,
            whisper_engine::commands::whisper_load_model,
            whisper_engine::commands::whisper_get_current_model,
            whisper_engine::commands::whisper_is_model_loaded,
            whisper_engine::commands::whisper_has_available_models,
            whisper_engine::commands::whisper_validate_model_ready,
            whisper_engine::commands::whisper_transcribe_audio,
            whisper_engine::commands::whisper_get_models_directory,
            whisper_engine::commands::whisper_download_model,
            whisper_engine::commands::whisper_cancel_download,
            whisper_engine::commands::whisper_delete_corrupted_model,
            // Parakeet engine commands
            parakeet_engine::commands::parakeet_init,
            parakeet_engine::commands::parakeet_get_available_models,
            parakeet_engine::commands::parakeet_load_model,
            parakeet_engine::commands::parakeet_get_current_model,
            parakeet_engine::commands::parakeet_is_model_loaded,
            parakeet_engine::commands::parakeet_has_available_models,
            parakeet_engine::commands::parakeet_validate_model_ready,
            parakeet_engine::commands::parakeet_transcribe_audio,
            parakeet_engine::commands::parakeet_get_models_directory,
            parakeet_engine::commands::parakeet_download_model,
            parakeet_engine::commands::parakeet_retry_download,
            parakeet_engine::commands::parakeet_cancel_download,
            parakeet_engine::commands::parakeet_delete_corrupted_model,
            parakeet_engine::commands::open_parakeet_models_folder,
            // Parallel processing commands
            whisper_engine::parallel_commands::initialize_parallel_processor,
            whisper_engine::parallel_commands::start_parallel_processing,
            whisper_engine::parallel_commands::pause_parallel_processing,
            whisper_engine::parallel_commands::resume_parallel_processing,
            whisper_engine::parallel_commands::stop_parallel_processing,
            whisper_engine::parallel_commands::get_parallel_processing_status,
            whisper_engine::parallel_commands::get_system_resources,
            whisper_engine::parallel_commands::check_resource_constraints,
            whisper_engine::parallel_commands::calculate_optimal_workers,
            whisper_engine::parallel_commands::prepare_audio_chunks,
            whisper_engine::parallel_commands::test_parallel_processing_setup,
            get_audio_devices,
            trigger_microphone_permission,
            request_recording_start,
            start_recording_with_devices,
            start_recording_with_devices_and_meeting,
            start_audio_level_monitoring,
            stop_audio_level_monitoring,
            is_audio_level_monitoring,
            // Recording pause/resume commands
            audio::recording_commands::pause_recording,
            audio::recording_commands::resume_recording,
            audio::recording_commands::is_recording_paused,
            audio::recording_commands::get_recording_state,
            audio::recording_commands::get_meeting_folder_path,
            // Reload sync commands (retrieve transcript history and meeting name)
            audio::recording_commands::get_transcript_history,
            audio::recording_commands::get_recording_meeting_name,
            state::get_meeting_session,
            state::update_meeting_session_title,
            state::clear_meeting_session_command,
            // Device monitoring commands (AirPods/Bluetooth disconnect/reconnect)
            audio::recording_commands::poll_audio_device_events,
            audio::recording_commands::get_reconnection_status,
            audio::recording_commands::attempt_device_reconnect,
            // Playback device detection (Bluetooth warning)
            audio::recording_commands::get_active_audio_output,
            // Audio recovery commands (for transcript recovery feature)
            audio::incremental_saver::recover_audio_from_checkpoints,
            audio::incremental_saver::cleanup_checkpoints,
            audio::incremental_saver::has_audio_checkpoints,
            console_utils::show_console,
            console_utils::hide_console,
            console_utils::toggle_console,
            ollama::get_ollama_models,
            ollama::pull_ollama_model,
            ollama::delete_ollama_model,
            ollama::get_ollama_model_context,
            openai::openai::get_openai_models,
            anthropic::anthropic::get_anthropic_models,
            groq::groq::get_groq_models,
            api::api_get_meetings,
            api::api_search_transcripts,
            api::api_get_profile,
            api::api_save_profile,
            api::api_update_profile,
            api::api_get_model_config,
            api::api_save_model_config,
            api::api_get_api_key,
            // api::api_get_auto_generate_setting,
            // api::api_save_auto_generate_setting,
            api::api_get_transcript_config,
            api::api_save_transcript_config,
            api::api_get_transcript_api_key,
            api::api_delete_meeting,
            api::api_get_meeting,
            api::api_get_meeting_metadata,
            api::api_get_meeting_transcripts,
            api::api_save_meeting_title,
            api::api_save_transcript,
            api::api_append_transcript,
            api::open_meeting_folder,
            api::test_backend_connection,
            api::debug_backend_connection,
            api::open_external_url,
            // Custom OpenAI commands
            api::api_save_custom_openai_config,
            api::api_get_custom_openai_config,
            api::api_test_custom_openai_connection,
            // Summary commands
            summary::commands::api_process_transcript,
            summary::commands::api_get_summary,
            summary::commands::api_save_meeting_summary,
            summary::commands::api_get_meeting_summary_language,
            summary::commands::api_save_meeting_summary_language,
            summary::commands::api_get_meeting_detected_summary_language,
            summary::commands::api_save_meeting_detected_summary_language,
            summary::commands::api_detect_transcript_summary_language,
            summary::commands::api_cancel_summary,
            // Template commands
            summary::template_commands::api_list_templates,
            summary::template_commands::api_get_template_details,
            summary::template_commands::api_validate_template,
            // Built-in AI commands
            summary::summary_engine::commands::builtin_ai_list_models,
            summary::summary_engine::commands::builtin_ai_get_model_info,
            summary::summary_engine::commands::builtin_ai_download_model,
            summary::summary_engine::commands::builtin_ai_cancel_download,
            summary::summary_engine::commands::builtin_ai_delete_model,
            summary::summary_engine::commands::builtin_ai_is_model_ready,
            summary::summary_engine::commands::builtin_ai_get_available_summary_model,
            summary::summary_engine::commands::builtin_ai_get_recommended_model,
            openrouter::get_openrouter_models,
            audio::recording_preferences::get_recording_preferences,
            audio::recording_preferences::set_recording_preferences,
            audio::recording_preferences::get_default_recordings_folder_path,
            audio::recording_preferences::open_recordings_folder,
            audio::recording_preferences::select_recording_folder,
            audio::recording_preferences::get_available_audio_backends,
            audio::recording_preferences::get_current_audio_backend,
            audio::recording_preferences::set_audio_backend,
            audio::recording_preferences::get_audio_backend_info,
            // Language preference commands
            set_language_preference,
            // Notification system commands
            notifications::commands::get_notification_settings,
            notifications::commands::set_notification_settings,
            notifications::commands::request_notification_permission,
            notifications::commands::show_notification,
            notifications::commands::show_test_notification,
            notifications::commands::is_dnd_active,
            notifications::commands::get_system_dnd_status,
            notifications::commands::set_manual_dnd,
            notifications::commands::set_notification_consent,
            notifications::commands::clear_notifications,
            notifications::commands::is_notification_system_ready,
            notifications::commands::initialize_notification_manager_manual,
            notifications::commands::test_notification_with_auto_consent,
            notifications::commands::get_notification_stats,
            // System audio capture commands
            audio::system_audio_commands::start_system_audio_capture_command,
            audio::system_audio_commands::list_system_audio_devices_command,
            audio::system_audio_commands::check_system_audio_permissions_command,
            audio::system_audio_commands::start_system_audio_monitoring,
            audio::system_audio_commands::stop_system_audio_monitoring,
            audio::system_audio_commands::get_system_audio_monitoring_status,
            // Screen Recording permission commands
            audio::permissions::check_screen_recording_permission_command,
            audio::permissions::request_screen_recording_permission_command,
            audio::permissions::trigger_system_audio_permission_command,
            // Database import commands
            database::commands::check_first_launch,
            database::commands::select_legacy_database_path,
            database::commands::detect_legacy_database,
            database::commands::check_default_legacy_database,
            database::commands::check_homebrew_database,
            database::commands::import_and_initialize_database,
            database::commands::initialize_fresh_database,
            // Database and Models path commands
            database::commands::get_database_directory,
            database::commands::open_database_folder,
            whisper_engine::commands::open_models_folder,
            // Onboarding commands
            onboarding::get_onboarding_status,
            frontend_bootstrap_complete,
            app_quit::complete_app_quit,
            app_quit::cancel_app_quit,
            get_build_info,
            onboarding::save_onboarding_status_cmd,
            onboarding::reset_onboarding_status_cmd,
            onboarding::complete_onboarding,
            // System settings commands
            #[cfg(target_os = "macos")]
            utils::open_system_settings,
            // Retranscription commands
            audio::retranscription::start_retranscription_command,
            audio::retranscription::cancel_retranscription_command,
            audio::retranscription::is_retranscription_in_progress_command,
            // Import audio commands
            audio::import::select_and_validate_audio_command,
            audio::import::validate_audio_file_command,
            audio::import::start_import_audio_command,
            audio::import::cancel_import_command,
            audio::import::is_import_in_progress_command,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if let Some(request_id) = _app_handle.state::<app_quit::QuitCoordinator>().request() {
                        api.prevent_exit();
                        tray::focus_main_window(_app_handle);
                        if let Err(error) = _app_handle.emit("app-quit-requested", request_id) {
                            log::error!("Could not request frontend save before quit: {}", error);
                        }
                    }
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => {
                    tray::focus_main_window(_app_handle);
                }
                tauri::RunEvent::Exit => {
                    log::info!("Application exiting, cleaning up resources...");
                    tauri::async_runtime::block_on(async {
                        // Clean up database connection and checkpoint WAL
                        if let Some(app_state) = _app_handle.try_state::<state::AppState>() {
                            log::info!("Starting database cleanup...");
                            if let Err(e) = app_state.db_manager.cleanup().await {
                                log::error!("Failed to cleanup database: {}", e);
                            } else {
                                log::info!("Database cleanup completed successfully");
                            }
                        } else {
                            log::warn!("AppState not available for database cleanup (likely first launch)");
                        }

                        // Clean up sidecar
                        log::info!("Cleaning up sidecar...");
                        if let Err(e) = summary::summary_engine::force_shutdown_sidecar().await {
                            log::error!("Failed to force shutdown sidecar: {}", e);
                        }
                    });
                    log::info!("Application cleanup complete");
                }
                _ => {}
            }
        });
}
