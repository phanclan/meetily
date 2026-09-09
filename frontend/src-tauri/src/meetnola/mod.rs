//! Meetnola product surface as an internal Tauri v2 plugin.
//!
//! Commands are registered on this plugin (not the app `invoke_handler`), so
//! frontend invokes use `plugin:meetnola|<command>`.

#[cfg(feature = "meetnola-automation")]
pub mod automation;
pub mod defaults;
pub mod frontend_logging;
pub mod live_query;
pub mod meeting_detection;
pub mod notes;

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

/// Register Meetnola IPC commands under the `meetnola` plugin namespace.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("meetnola")
        .setup(|app, _| { app.manage(live_query::QueryRequests::default()); Ok(()) })
        .invoke_handler(tauri::generate_handler![
            frontend_logging::append_frontend_log,
            live_query::live_query,
            live_query::prepare_live_query,
            live_query::cancel_live_query,
            meeting_detection::start_call_detection,
            meeting_detection::stop_call_detection,
            meeting_detection::set_call_detection_enabled,
            meeting_detection::get_call_detection_enabled,
            notes::save_meeting_notes,
            notes::get_meeting_notes,
            notes::move_meeting_notes,
        ])
        .build()
}

/// Lifecycle hooks that must run after the database is initialized.
pub fn start_after_database<R: Runtime>(app: &AppHandle<R>) {
    meeting_detection::start_detection(app.clone());

    #[cfg(feature = "meetnola-automation")]
    {
        if std::env::var("MEETILY_AUTOMATION").as_deref() == Ok("1") {
            if let Some(app_state) = app.try_state::<crate::state::AppState>() {
                let db = app_state.db_manager.clone();
                tauri::async_runtime::spawn(automation::start(db));
            } else {
                log::warn!("[automation] AppState not available; server not started");
            }
        }
    }
}
