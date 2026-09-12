//! Afterword product surface as an internal Tauri v2 plugin.
//!
//! Commands are registered on this plugin (not the app `invoke_handler`), so
//! frontend invokes use `plugin:afterword|<command>`.

#[cfg(feature = "afterword-automation")]
pub mod automation;
pub mod defaults;
pub mod chat_history;
pub mod note_tasks;
pub mod frontend_logging;
pub mod live_query;
pub mod library_search;
pub mod library_chats;
pub mod meeting_detection;
pub mod notes;
pub mod note_folders;
pub mod previous_summary;
pub mod trash;
pub mod markdown_export;

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

/// Register Afterword IPC commands under the `afterword` plugin namespace.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("afterword")
        .setup(|app, _| { app.manage(live_query::QueryRequests::default()); Ok(()) })
        .invoke_handler(tauri::generate_handler![
            frontend_logging::append_frontend_log,
            live_query::live_query,
            live_query::prepare_live_query,
            live_query::cancel_live_query,
            chat_history::get_meeting_chat,
            chat_history::save_meeting_chat,
            chat_history::get_recording_chat,
            chat_history::save_recording_chat,
            note_tasks::list_note_tasks,
            note_tasks::save_meeting_notes_if_unchanged,
            chat_history::discard_recording_chat,
            library_search::search_library_sources,
            library_search::get_recent_library_sources,
            library_search::search_saved_meetings,
            library_search::get_saved_search_match,
            library_chats::get_library_chat,
            library_chats::save_library_chat,
            library_chats::get_library_chat_settings,
            library_chats::save_library_chat_settings,
            library_chats::list_library_chats,
            library_chats::set_library_chat_archived,
            meeting_detection::start_call_detection,
            meeting_detection::stop_call_detection,
            meeting_detection::set_call_detection_enabled,
            meeting_detection::get_call_detection_enabled,
            notes::save_meeting_notes,
            notes::create_note,
            notes::get_meeting_notes,
            notes::move_meeting_notes,
            note_folders::list_note_folders,
            note_folders::create_note_folder,
            note_folders::rename_note_folder,
            note_folders::get_note_folder_members,
            note_folders::get_meeting_note_folders,
            note_folders::set_meeting_note_folder,
            trash::trash_meeting,
            trash::restore_trashed_meeting,
            trash::list_trashed_meetings,
            trash::delete_trashed_meeting,
            previous_summary::get_previous_summary,
            previous_summary::restore_previous_summary,
            markdown_export::get_export_folder,
            markdown_export::choose_export_folder,
            markdown_export::export_meeting_markdown,
        ])
        .build()
}

/// Lifecycle hooks that must run after the database is initialized.
pub fn start_after_database<R: Runtime>(app: &AppHandle<R>) {
    meeting_detection::start_detection(app.clone());

    #[cfg(feature = "afterword-automation")]
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
