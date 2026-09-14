use crate::afterword::meeting_title::{
    derive_title_from_notes, is_generated_or_placeholder_title, schedule_generated_title,
};
use crate::database::models::MeetingNotes;
use crate::database::repositories::meeting::MeetingsRepository;
use crate::database::repositories::notes::NotesRepository;
use crate::state::AppState;
use tauri::{AppHandle, Runtime};

/// Create a saved note without starting an audio recording.
#[tauri::command]
pub async fn create_note<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    draft_id: String,
    title: String,
    notes_markdown: String,
    notes_json: String,
    folder_id: Option<String>,
) -> Result<String, String> {
    let pool = state.db_manager.pool().clone();
    let title = if is_generated_or_placeholder_title(&title) {
        derive_title_from_notes(&notes_markdown).unwrap_or_else(|| "New note".into())
    } else {
        title.trim().to_owned()
    };
    let meeting_id = NotesRepository::create_note(
        &pool,
        &draft_id,
        &title,
        &notes_markdown,
        &notes_json,
        folder_id.as_deref(),
    )
    .await?;
    schedule_generated_title(app, pool, meeting_id.clone());
    Ok(meeting_id)
}

/// Save (upsert) plain-text and BlockNote representations for an existing note.
#[tauri::command]
pub async fn save_meeting_notes<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    notes_markdown: Option<String>,
    notes_json: Option<String>,
) -> Result<(), String> {
    let pool = state.db_manager.pool().clone();
    NotesRepository::save_notes(
        &pool,
        &meeting_id,
        notes_markdown.as_deref(),
        notes_json.as_deref(),
    )
    .await
    .map_err(|e| format!("Failed to save notes: {}", e))?;

    if let Some(candidate_title) = notes_markdown
        .as_deref()
        .and_then(derive_title_from_notes)
    {
        if let Ok(Some(meeting)) = MeetingsRepository::get_meeting_metadata(&pool, &meeting_id).await {
            if is_generated_or_placeholder_title(&meeting.title) && meeting.title.trim() != candidate_title {
                let _ = MeetingsRepository::update_meeting_title(&pool, &meeting_id, &candidate_title).await;
            }
        }
    }

    schedule_generated_title(app, pool, meeting_id);
    Ok(())
}

/// Get notes for a meeting. Returns `null` if no notes have been saved yet.
#[tauri::command]
pub async fn get_meeting_notes<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<MeetingNotes>, String> {
    let pool = state.db_manager.pool();
    NotesRepository::get_notes(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to get notes: {}", e))
}

#[tauri::command]
pub async fn move_meeting_notes<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    from_meeting_id: String,
    to_meeting_id: String,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    NotesRepository::move_notes(pool, &from_meeting_id, &to_meeting_id)
        .await
        .map_err(|e| format!("Failed to move notes: {}", e))
}

#[cfg(test)]
mod quality_tests {
    use super::{derive_title_from_notes, is_generated_or_placeholder_title};

    #[test]
    fn quality_unicode_note_titles_are_truncated_at_character_boundaries() {
        for text in [format!("{}é", "a".repeat(95)), "界".repeat(100), "🙂".repeat(100)] {
            let title = derive_title_from_notes(&text).unwrap();
            assert!(title.chars().count() <= 96);
            assert!(text.starts_with(&title));
        }
    }

    #[test]
    fn recognizes_current_and_legacy_generated_titles() {
        assert!(is_generated_or_placeholder_title("Meeting 12_09_26_23_04_55"));
        assert!(is_generated_or_placeholder_title("Meeting 2026-09-12_23-04-55"));
        assert!(is_generated_or_placeholder_title("New note"));
        assert!(is_generated_or_placeholder_title("+ New Call"));
        assert!(is_generated_or_placeholder_title("Untitled"));
        assert!(!is_generated_or_placeholder_title("Project sync"));
    }
}
