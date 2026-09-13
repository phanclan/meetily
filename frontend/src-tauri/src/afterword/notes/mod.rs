use crate::database::models::MeetingNotes;
use crate::database::repositories::meeting::MeetingsRepository;
use crate::database::repositories::notes::NotesRepository;
use crate::state::AppState;
use tauri::Runtime;

fn is_generated_or_placeholder_title(title: &str) -> bool {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return true;
    }

    if matches!(
        trimmed,
        "New note"
            | "+ New Call"
            | "Untitled meeting"
            | "Untitled"
            | "Untitled Meeting"
            | "New Meeting"
    ) {
        return true;
    }

    let rest = match trimmed.strip_prefix("Meeting ") {
        Some(rest) => rest,
        None => return false,
    };

    let bytes = rest.as_bytes();
    // Legacy: YYYY-MM-DD_HH-MM-SS (19 chars)
    let legacy = bytes.len() == 19
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'_'
        && bytes[13] == b'-'
        && bytes[16] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13 | 16) || byte.is_ascii_digit());
    if legacy {
        return true;
    }

    // Current: DD_MM_YY_HH_MM_SS (17 chars)
    bytes.len() == 17
        && bytes[2] == b'_'
        && bytes[5] == b'_'
        && bytes[8] == b'_'
        && bytes[11] == b'_'
        && bytes[14] == b'_'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 2 | 5 | 8 | 11 | 14) || byte.is_ascii_digit())
}

fn normalize_title_line(line: &str) -> String {
    let trimmed = line.trim();
    let without_heading = trimmed.trim_start_matches('#').trim();
    let without_bullet = without_heading
        .trim_start_matches("- ")
        .trim_start_matches("* ")
        .trim_start_matches("> ")
        .trim_start_matches("[ ] ")
        .trim_start_matches("[x] ")
        .trim();

    let without_numbered = without_bullet
        .find(". ")
        .filter(|index| without_bullet[..*index].chars().all(|c| c.is_ascii_digit()))
        .map(|index| without_bullet[index + 2..].trim())
        .unwrap_or(without_bullet);

    without_numbered
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn derive_title_from_notes(notes_markdown: &str) -> Option<String> {
    for line in notes_markdown.lines() {
        let candidate = normalize_title_line(line);
        if candidate.len() < 4 {
            continue;
        }
        if candidate.starts_with("http://") || candidate.starts_with("https://") {
            continue;
        }

        let mut title = candidate;
        if title.len() > 96 {
            title = title.chars().take(96).collect::<String>().trim().to_string();
            if let Some(last_space) = title.rfind(' ') {
                title.truncate(last_space);
            }
        }

        if !title.is_empty() {
            return Some(title);
        }
    }

    None
}

/// Create a saved note without starting an audio recording.
#[tauri::command]
pub async fn create_note(
    state: tauri::State<'_, AppState>, draft_id: String, title: String,
    notes_markdown: String, notes_json: String, folder_id: Option<String>,
) -> Result<String, String> {
    let title = if is_generated_or_placeholder_title(&title) {
        derive_title_from_notes(&notes_markdown).unwrap_or_else(|| "New note".into())
    } else { title.trim().to_owned() };
    NotesRepository::create_note(state.db_manager.pool(), &draft_id, &title,
        &notes_markdown, &notes_json, folder_id.as_deref()).await
}

/// Save (upsert) plain-text and BlockNote representations for an existing note.
#[tauri::command]
pub async fn save_meeting_notes<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    notes_markdown: Option<String>,
    notes_json: Option<String>,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    NotesRepository::save_notes(
        pool,
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
        if let Ok(Some(meeting)) = MeetingsRepository::get_meeting_metadata(pool, &meeting_id).await {
            if is_generated_or_placeholder_title(&meeting.title) && meeting.title.trim() != candidate_title {
                let _ = MeetingsRepository::update_meeting_title(pool, &meeting_id, &candidate_title).await;
            }
        }
    }

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
