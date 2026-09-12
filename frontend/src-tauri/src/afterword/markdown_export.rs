use crate::state::AppState;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::{io::Write, path::{Path, PathBuf}};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;

/// Store filename intentionally keeps the legacy `meetnola-` prefix: renaming it
/// would drop the export folder a user already picked. Same data-continuity
/// reason the bundle id stays `com.meetnola.tester`.
const STORE: &str = "meetnola-export.json";

#[tauri::command]
pub fn get_export_folder<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<Option<String>, String> {
    if let Some(folder) = app.store(STORE).map_err(|e| e.to_string())?.get("folder")
        .and_then(|value| value.as_str().map(str::to_owned)) {
        return Ok(Some(folder));
    }
    let documents = app.path().document_dir().map_err(|e| format!("Could not locate Documents. Choose an export folder: {e}"))?;
    Ok(Some(documents.to_str().ok_or("The Documents path is not valid Unicode. Choose an export folder.")?.to_owned()))
}

#[tauri::command]
pub async fn choose_export_folder<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app.dialog().file().set_title("Choose Markdown export folder").blocking_pick_folder() else { return Ok(None); };
        let path = folder.into_path().map_err(|e| e.to_string())?;
        if !path.is_dir() { return Err("Choose an existing folder.".into()); }
        let folder = path.to_str().ok_or("This folder path is not valid Unicode.")?.to_owned();
        let store = app.store(STORE).map_err(|e| e.to_string())?;
        let previous = store.get("folder");
        store.set("folder", Value::String(folder.clone()));
        if let Err(error) = store.save() {
            if let Some(previous) = previous { store.set("folder", previous); } else { store.delete("folder"); }
            return Err(format!("Could not remember the folder: {error}"));
        }
        Ok(Some(folder))
    }).await.map_err(|e| e.to_string())?
}

async fn snapshot(pool: &SqlitePool, id: &str) -> Result<(String, String), String> {
    // One read transaction includes every transcript row, independent of UI pagination.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let meeting = sqlx::query("SELECT title, created_at FROM meetings WHERE id = ? AND NOT EXISTS (SELECT 1 FROM meeting_trash WHERE meeting_id = meetings.id)")
        .bind(id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?.ok_or("This note is unavailable or in Trash.")?;
    let title: String = meeting.get("title");
    let date: String = meeting.get("created_at");
    let notes: Option<String> = sqlx::query_scalar("SELECT notes_markdown FROM meeting_notes WHERE meeting_id = ?")
        .bind(id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?.flatten();
    let summary = sqlx::query("SELECT status, result FROM summary_processes WHERE meeting_id = ?")
        .bind(id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut enhanced = String::new();
    if let Some(summary) = summary {
        let status: String = summary.get("status");
        if matches!(status.to_lowercase().as_str(), "pending" | "processing") {
            return Err("Wait for enhancement to finish before exporting.".into());
        }
        if let Some(raw) = summary.get::<Option<String>, _>("result") {
            let value: Value = serde_json::from_str(&raw).map_err(|_| "The enhancement could not be read.")?;
            enhanced = value.get("markdown").and_then(Value::as_str)
                .ok_or("Open enhanced notes and save them as Markdown before exporting.")?.to_owned();
        }
    }
    let rows = sqlx::query("SELECT transcript, timestamp, audio_start_time FROM transcripts WHERE meeting_id = ? ORDER BY COALESCE(audio_start_time, 0), id")
        .bind(id).fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    let exported = chrono::Utc::now().to_rfc3339();
    // JSON string literals are valid YAML scalars, including multiline or quoted titles.
    let mut document = format!("---\nsource: afterword\nmeeting_id: {}\ntitle: {}\ncreated_at: {}\nexported_at: {}\ntranscript_segments: {}\n---\n\n# {}\n\n## Enhanced notes\n\n{}\n\n## Written notes\n\n{}\n\n## Transcript\n\n",
        serde_json::json!(id), serde_json::json!(title), serde_json::json!(date), serde_json::json!(exported), rows.len(),
        title.replace(['\r', '\n'], " "), if enhanced.trim().is_empty() { "_No enhanced notes._" } else { &enhanced },
        notes.as_deref().filter(|text| !text.trim().is_empty()).unwrap_or("_No written notes._"));
    if rows.is_empty() { document.push_str("_No transcript recorded._\n"); }
    for row in rows {
        let text: String = row.get("transcript");
        let seconds: Option<f64> = row.get("audio_start_time");
        let time = match seconds.filter(|s| s.is_finite() && *s >= 0.0) {
            Some(seconds) => { let seconds = seconds.floor() as u64; format!("{:02}:{:02}:{:02}", seconds / 3600, seconds / 60 % 60, seconds % 60) }
            None => row.get::<String, _>("timestamp"),
        };
        document.push_str(&format!("[{time}] {text}\n\n"));
    }
    Ok((title, document))
}

fn write_snapshot(folder: &Path, title: &str, document: &str) -> Result<PathBuf, String> {
    if !folder.is_absolute() || !folder.is_dir() { return Err("The export folder is unavailable. Choose an existing folder.".into()); }
    let mut slug = String::new();
    for c in title.chars().take(60) {
        let c = if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' };
        if slug.len() + c.len_utf8() > 120 { break; }
        slug.push(c);
    }
    let name = format!("{}-{}-{}.md", chrono::Utc::now().format("%Y%m%d-%H%M%S"), slug.trim_matches('-'), uuid::Uuid::new_v4());
    let path = folder.join(name);
    let mut file = tempfile::Builder::new().prefix(".afterword-").tempfile_in(folder).map_err(|e| format!("Could not write to the export folder: {e}"))?;
    file.write_all(document.as_bytes()).and_then(|_| file.as_file().sync_all()).map_err(|e| format!("Could not finish the export: {e}"))?;
    file.persist_noclobber(&path).map_err(|e| format!("Could not publish the export: {e}"))?;
    Ok(path)
}

#[tauri::command]
pub async fn export_meeting_markdown<R: tauri::Runtime>(app: tauri::AppHandle<R>, state: tauri::State<'_, AppState>, meeting_id: String) -> Result<String, String> {
    let folder = get_export_folder(app)?.ok_or("Choose an export folder first.")?;
    let (title, document) = snapshot(state.db_manager.pool(), &meeting_id).await?;
    tauri::async_runtime::spawn_blocking(move || write_snapshot(Path::new(&folder), &title, &document)
        .map(|path| path.to_string_lossy().into_owned())).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn export_keeps_all_sources_and_rejects_pending_or_trashed_notes() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings(id,title,created_at,updated_at) VALUES ('A', 'Quoted: \"title\"', '2026-09-09', '')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO meeting_notes(meeting_id, notes_json, notes_markdown, created_at, updated_at) VALUES ('A','[]','Original café note','','')").execute(&pool).await.unwrap();
        for i in 0..205 {
            sqlx::query("INSERT INTO transcripts(id, meeting_id, transcript, timestamp, audio_start_time) VALUES (?, 'A', ?, 'fallback', ?)")
                .bind(format!("t{i:03}")).bind(format!("Exact passage {i}" )).bind(i as f64).execute(&pool).await.unwrap();
        }
        let (_, text) = snapshot(&pool, "A").await.unwrap();
        assert!(text.contains("title: \"Quoted: \\\"title\\\"\""));
        assert!(text.contains("transcript_segments: 205"));
        assert!(text.contains("Original café note"));
        assert!(text.contains("[00:03:24] Exact passage 204"));
        assert_eq!(text.matches("Exact passage").count(), 205);
        let repo = crate::database::repositories::summary::SummaryProcessesRepository::create_or_reset_process;
        repo(&pool, "A").await.unwrap();
        assert!(snapshot(&pool, "A").await.unwrap_err().contains("finish"));
        crate::database::repositories::summary::SummaryProcessesRepository::update_process_completed(&pool, "A", serde_json::json!({"markdown":"- [ ] Keep this edit"}), 1, 1.0).await.unwrap();
        assert!(snapshot(&pool, "A").await.unwrap().1.contains("- [ ] Keep this edit"));
        sqlx::query("INSERT INTO meeting_trash VALUES ('A','')").execute(&pool).await.unwrap();
        assert!(snapshot(&pool, "A").await.is_err());
        assert!(snapshot(&pool, "missing").await.is_err());
    }

    #[test]
    fn export_is_atomic_unique_and_never_overwrites_external_edits() {
        let folder = tempfile::tempdir().unwrap();
        let first = write_snapshot(folder.path(), "../../日本語\nTitle", "first").unwrap();
        std::fs::write(&first, "Edited in Obsidian").unwrap();
        let second = write_snapshot(folder.path(), "../../日本語\nTitle", "second").unwrap();
        assert_ne!(first, second);
        assert_eq!(first.parent(), Some(folder.path()));
        assert_eq!(std::fs::read_to_string(first).unwrap(), "Edited in Obsidian");
        assert_eq!(std::fs::read_to_string(second).unwrap(), "second");
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 2);
        let unicode = write_snapshot(folder.path(), &"𐐀".repeat(100), "Unicode title").unwrap();
        assert!(unicode.file_name().unwrap().len() < 255);
        assert!(write_snapshot(&folder.path().join("missing"), "Title", "text").is_err());
    }
}
