use crate::database::manager::DatabaseManager;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use uuid::Uuid;

pub struct AppState {
    pub db_manager: DatabaseManager,
}

pub const MEETING_SESSION_EVENT: &str = "meeting-session-updated";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MeetingSessionStatus {
    Recording,
    Paused,
    Stopping,
    ProcessingTranscripts,
    Saving,
    Stopped,
    Saved,
    Partial,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingSession {
    pub session_id: String,
    pub persisted_meeting_id: Option<String>,
    pub title: String,
    pub status: MeetingSessionStatus,
    pub started_at: String,
    pub updated_at: String,
    pub ended_at: Option<String>,
    pub selected_mic_device: Option<String>,
    pub selected_system_device: Option<String>,
    pub folder_path: Option<String>,
    pub transcript_chunks_pending: u64,
    pub transcript_processing_active: bool,
    pub transcript_last_activity_ms: u64,
    pub last_message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingSessionDiagnostics {
    pub session: Option<MeetingSession>,
    pub is_recording_native: bool,
    pub worker_active: bool,
    pub chunks_in_queue: usize,
    pub last_activity_ms: u64,
    pub selected_mic_device: Option<String>,
    pub selected_system_device: Option<String>,
}

#[derive(Default)]
pub struct MeetingSessionState(pub Mutex<Option<MeetingSession>>);

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn apply_transcription_runtime_fields(session: &mut MeetingSession) {
    let (chunks_in_queue, is_processing, last_activity_ms) =
        crate::audio::transcription::get_worker_status();
    session.transcript_chunks_pending = chunks_in_queue as u64;
    session.transcript_processing_active = is_processing;
    session.transcript_last_activity_ms = last_activity_ms;
}

fn snapshot_meeting_session(session: Option<&MeetingSession>) -> Option<MeetingSession> {
    session.cloned().map(|mut session| {
        apply_transcription_runtime_fields(&mut session);
        session
    })
}

fn emit_session_update<R: Runtime>(
    app: &AppHandle<R>,
    session: Option<&MeetingSession>,
) -> Result<(), String> {
    app.emit(MEETING_SESSION_EVENT, snapshot_meeting_session(session))
        .map_err(|e| e.to_string())
}

pub fn read_meeting_session<R: Runtime>(app: &AppHandle<R>) -> Option<MeetingSession> {
    let state = app.state::<MeetingSessionState>();
    state.0.lock().ok().and_then(|session| snapshot_meeting_session(session.as_ref()))
}

pub fn start_meeting_session<R: Runtime>(
    app: &AppHandle<R>,
    title: String,
    selected_mic_device: Option<String>,
    selected_system_device: Option<String>,
) -> Result<MeetingSession, String> {
    let now = now_rfc3339();
    let mut session = MeetingSession {
        session_id: format!("session-{}", Uuid::new_v4()),
        persisted_meeting_id: None,
        title,
        status: MeetingSessionStatus::Recording,
        started_at: now.clone(),
        updated_at: now,
        ended_at: None,
        selected_mic_device,
        selected_system_device,
        folder_path: None,
        transcript_chunks_pending: 0,
        transcript_processing_active: false,
        transcript_last_activity_ms: 0,
        last_message: Some("Recording in progress".to_string()),
        error: None,
    };
    apply_transcription_runtime_fields(&mut session);

    let state = app.state::<MeetingSessionState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock meeting session state: {}", e))?;
    *guard = Some(session.clone());
    drop(guard);

    emit_session_update(app, Some(&session))?;
    Ok(session)
}

pub fn update_meeting_session<R: Runtime, F>(
    app: &AppHandle<R>,
    updater: F,
) -> Result<Option<MeetingSession>, String>
where
    F: FnOnce(&mut MeetingSession),
{
    let state = app.state::<MeetingSessionState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock meeting session state: {}", e))?;

    if let Some(session) = guard.as_mut() {
        updater(session);
        session.updated_at = now_rfc3339();
        apply_transcription_runtime_fields(session);
        let updated = session.clone();
        drop(guard);
        emit_session_update(app, Some(&updated))?;
        Ok(Some(updated))
    } else {
        Ok(None)
    }
}

pub fn mark_meeting_session_stopping<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    update_meeting_session(app, |session| {
        session.status = MeetingSessionStatus::Stopping;
        session.last_message = Some("Stopping recording...".to_string());
        session.error = None;
    })?;
    Ok(())
}

pub fn mark_meeting_session_processing_transcripts<R: Runtime>(
    app: &AppHandle<R>,
    message: Option<String>,
) -> Result<(), String> {
    let message = message.unwrap_or_else(|| "Processing remaining transcript chunks...".to_string());
    update_meeting_session(app, move |session| {
        session.status = MeetingSessionStatus::ProcessingTranscripts;
        session.last_message = Some(message.clone());
        session.error = None;
    })?;
    Ok(())
}

pub fn mark_meeting_session_paused<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    update_meeting_session(app, |session| {
        session.status = MeetingSessionStatus::Paused;
        session.last_message = Some("Recording paused".to_string());
        session.error = None;
    })?;
    Ok(())
}

pub fn mark_meeting_session_recording<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    update_meeting_session(app, |session| {
        session.status = MeetingSessionStatus::Recording;
        session.last_message = Some("Recording in progress".to_string());
        session.error = None;
    })?;
    Ok(())
}

pub fn finalize_meeting_session<R: Runtime>(
    app: &AppHandle<R>,
    folder_path: Option<String>,
    title: Option<String>,
) -> Result<(), String> {
    update_meeting_session(app, |session| {
        session.status = MeetingSessionStatus::Stopped;
        session.folder_path = folder_path;
        if let Some(title) = title {
            session.title = title;
        }
        session.ended_at = Some(now_rfc3339());
        session.last_message = Some("Recording finalized. Waiting for save...".to_string());
        session.error = None;
    })?;
    Ok(())
}

pub fn mark_meeting_session_partial<R: Runtime>(
    app: &AppHandle<R>,
    error_message: String,
    folder_path: Option<String>,
    title: Option<String>,
) -> Result<(), String> {
    update_meeting_session(app, move |session| {
        session.status = MeetingSessionStatus::Partial;
        session.folder_path = folder_path.clone();
        if let Some(title) = title.clone() {
            session.title = title;
        }
        session.ended_at = Some(now_rfc3339());
        session.last_message = Some(error_message.clone());
        session.error = Some(error_message.clone());
    })?;
    Ok(())
}

pub fn mark_meeting_session_saving<R: Runtime>(
    app: &AppHandle<R>,
    message: Option<String>,
) -> Result<(), String> {
    let message = message.unwrap_or_else(|| "Saving meeting...".to_string());
    update_meeting_session(app, move |session| {
        session.status = MeetingSessionStatus::Saving;
        session.last_message = Some(message.clone());
        session.error = None;
    })?;
    Ok(())
}

pub fn mark_meeting_session_saved<R: Runtime>(
    app: &AppHandle<R>,
    persisted_meeting_id: String,
    title: Option<String>,
    folder_path: Option<String>,
) -> Result<(), String> {
    update_meeting_session(app, |session| {
        session.status = MeetingSessionStatus::Saved;
        session.persisted_meeting_id = Some(persisted_meeting_id);
        if let Some(title) = title {
            session.title = title;
        }
        if folder_path.is_some() {
            session.folder_path = folder_path;
        }
        if session.ended_at.is_none() {
            session.ended_at = Some(now_rfc3339());
        }
        session.last_message = Some("Meeting saved".to_string());
        session.error = None;
    })?;
    Ok(())
}

pub fn mark_meeting_session_error<R: Runtime>(
    app: &AppHandle<R>,
    error_message: String,
) -> Result<(), String> {
    update_meeting_session(app, |session| {
        session.status = MeetingSessionStatus::Error;
        session.last_message = Some(error_message.clone());
        session.error = Some(error_message);
    })?;
    Ok(())
}

pub fn clear_meeting_session<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<MeetingSessionState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock meeting session state: {}", e))?;
    *guard = None;
    drop(guard);

    emit_session_update(app, None)?;
    Ok(())
}

#[tauri::command]
pub async fn get_meeting_session<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<MeetingSession>, String> {
    Ok(read_meeting_session(&app))
}

#[tauri::command]
pub async fn get_meeting_session_diagnostics<R: Runtime>(
    app: AppHandle<R>,
) -> Result<MeetingSessionDiagnostics, String> {
    let session = read_meeting_session(&app);
    let (chunks_in_queue, worker_active, last_activity_ms) =
        crate::audio::transcription::get_worker_status();

    Ok(MeetingSessionDiagnostics {
        selected_mic_device: session
            .as_ref()
            .and_then(|session| session.selected_mic_device.clone()),
        selected_system_device: session
            .as_ref()
            .and_then(|session| session.selected_system_device.clone()),
        is_recording_native: crate::audio::recording_commands::is_recording().await,
        worker_active,
        chunks_in_queue,
        last_activity_ms,
        session,
    })
}

#[tauri::command]
pub async fn update_meeting_session_title<R: Runtime>(
    app: AppHandle<R>,
    title: String,
) -> Result<(), String> {
    update_meeting_session(&app, |session| {
        session.title = title.clone();
    })?;
    Ok(())
}

#[tauri::command]
pub async fn mark_meeting_session_saving_command<R: Runtime>(
    app: AppHandle<R>,
    message: Option<String>,
) -> Result<(), String> {
    mark_meeting_session_saving(&app, message)
}

#[tauri::command]
pub async fn clear_meeting_session_command<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    clear_meeting_session(&app)
}
