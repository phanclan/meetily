use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Default)]
struct QuitState {
    ready: bool,
    approved: bool,
    next: u64,
    pending: Option<u64>,
}

#[derive(Default)]
pub struct QuitCoordinator(Mutex<QuitState>);

#[cfg(target_os = "macos")]
pub fn install_quit_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let menu = Menu::default(app)?;
    let items = menu.items()?;
    let app_menu = items.first().and_then(|item| item.as_submenu())
        .ok_or("Default application menu is missing")?;
    let quit_label = PredefinedMenuItem::quit(app, None)?.text()?;
    let quit_index = app_menu.items()?.iter().position(|item| {
        item.as_predefined_menuitem().is_some_and(|item| item.text().ok().as_ref() == Some(&quit_label))
    }).ok_or("Default Quit item is missing")?;
    // The predefined macOS item calls Cocoa terminate: directly, bypassing ExitRequested.
    let quit = MenuItem::with_id(app, "app-safe-quit", quit_label, true, Some("CmdOrCtrl+Q"))?;
    app_menu.remove_at(quit_index)?;
    app_menu.insert(&quit, quit_index)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "app-safe-quit" {
            crate::persist_main_window_before_quit(app);
            app.exit(0);
        }
    });
    Ok(())
}

impl QuitCoordinator {
    pub fn frontend_ready(&self) {
        self.0.lock().unwrap().ready = true;
    }

    pub fn request(&self) -> Option<u64> {
        let mut state = self.0.lock().unwrap();
        if !state.ready || state.approved {
            return None;
        }
        if state.pending.is_none() {
            state.next += 1;
            state.pending = Some(state.next);
        }
        state.pending
    }

    fn resolve(&self, request_id: u64, approved: bool) -> Result<(), String> {
        let mut state = self.0.lock().unwrap();
        if state.pending != Some(request_id) {
            return Err("This quit request is no longer active".into());
        }
        state.pending = None;
        state.approved = approved;
        Ok(())
    }
}

#[tauri::command]
pub async fn complete_app_quit<R: Runtime>(app: AppHandle<R>, request_id: u64) -> Result<(), String> {
    let session_busy = crate::state::read_meeting_session(&app)
        .is_some_and(|session| session_blocks_quit(&session.status));
    if crate::audio::recording_commands::is_recording().await || session_busy {
        return Err("Stop the recording and wait for it to save before quitting.".into());
    }
    app.state::<QuitCoordinator>().resolve(request_id, true)?;
    crate::persist_main_window_before_quit(&app);
    app.exit(0);
    Ok(())
}

fn session_blocks_quit(status: &crate::state::MeetingSessionStatus) -> bool {
    use crate::state::MeetingSessionStatus::*;
    // Stopped means capture finished, but the meeting has not been saved yet.
    matches!(status, Recording | Paused | Stopping | Stopped | ProcessingTranscripts | Saving)
}

#[tauri::command]
pub fn cancel_app_quit<R: Runtime>(app: AppHandle<R>, request_id: u64) -> Result<(), String> {
    app.state::<QuitCoordinator>().resolve(request_id, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quit_waits_for_readiness_and_an_approved_current_request() {
        let coordinator = QuitCoordinator::default();
        assert_eq!(coordinator.request(), None);
        coordinator.frontend_ready();
        let first = coordinator.request().unwrap();
        assert_eq!(coordinator.request(), Some(first));
        assert!(coordinator.resolve(first + 1, true).is_err());
        coordinator.resolve(first, false).unwrap();
        let second = coordinator.request().unwrap();
        assert_ne!(first, second);
        assert!(coordinator.resolve(first, true).is_err());
        coordinator.resolve(second, true).unwrap();
        assert_eq!(coordinator.request(), None);
    }

    #[test]
    fn finalized_recording_cannot_quit_until_the_meeting_is_saved() {
        use crate::state::MeetingSessionStatus::*;
        for status in [Recording, Paused, Stopping, ProcessingTranscripts, Stopped, Saving] {
            assert!(session_blocks_quit(&status));
        }
        assert!(!session_blocks_quit(&Saved));
    }
}
