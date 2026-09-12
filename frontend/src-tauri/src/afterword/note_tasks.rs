use crate::state::AppState;
use serde::Serialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTask {
    meeting_id: String,
    title: String,
    created_at: String,
    revision: String,
    block_id: String,
    text: String,
    checked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPage { tasks: Vec<NoteTask>, has_more: bool }

fn inline_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items.iter().map(inline_text).collect(),
        Value::Object(item) => item.get("text").and_then(Value::as_str).map(str::to_owned)
            .unwrap_or_else(|| item.get("content").map(inline_text).unwrap_or_default()),
        _ => String::new(),
    }
}

async fn list(pool: &SqlitePool, checked: bool, folder_id: Option<&str>, offset: i64) -> Result<TaskPage, String> {
    // Read checkbox blocks from the original JSON, including nested children.
    // Malformed legacy notes cannot break the entire collection.
    let rows = sqlx::query("SELECT m.id AS meeting_id, m.title, m.created_at, n.updated_at AS revision,
            json_extract(CASE WHEN j.type = 'object' THEN j.value ELSE '{}' END, '$.id') AS block_id,
            json_quote(json_extract(CASE WHEN j.type = 'object' THEN j.value ELSE '{}' END, '$.content')) AS content,
            CASE WHEN json_extract(CASE WHEN j.type = 'object' THEN j.value ELSE '{}' END, '$.props.checked') = 1 THEN 1 ELSE 0 END AS checked
        FROM meetings m JOIN meeting_notes n ON n.meeting_id = m.id
        JOIN json_tree(CASE WHEN json_valid(n.notes_json) THEN n.notes_json ELSE '[]' END) j
        WHERE json_extract(CASE WHEN j.type = 'object' THEN j.value ELSE '{}' END, '$.type') = 'checkListItem'
          AND typeof(block_id) = 'text' AND length(block_id) > 0 AND checked = ?
          AND NOT EXISTS (SELECT 1 FROM meeting_trash WHERE meeting_id = m.id)
          AND (? IS NULL OR EXISTS (SELECT 1 FROM note_folder_members WHERE meeting_id = m.id AND folder_id = ?))
        ORDER BY m.created_at DESC, m.id, block_id LIMIT 31 OFFSET ?")
        .bind(checked).bind(folder_id).bind(folder_id).bind(offset.max(0)).fetch_all(pool).await
        .map_err(|e| format!("Could not load follow-ups: {e}"))?;
    let has_more = rows.len() > 30;
    let tasks = rows.into_iter().take(30).map(|row| {
        let raw: Option<String> = row.get("content");
        let text = raw.as_deref().and_then(|json| serde_json::from_str::<Value>(json).ok()).map(|value| inline_text(&value)).unwrap_or_default();
        NoteTask { meeting_id: row.get("meeting_id"), title: row.get("title"), created_at: row.get("created_at"),
            revision: row.get("revision"), block_id: row.get("block_id"), text, checked: row.get::<i64, _>("checked") != 0 }
    }).collect();
    Ok(TaskPage { tasks, has_more })
}

#[tauri::command]
pub async fn list_note_tasks(state: tauri::State<'_, AppState>, checked: bool, folder_id: Option<String>, offset: i64) -> Result<TaskPage, String> {
    list(state.db_manager.pool(), checked, folder_id.as_deref(), offset).await
}

async fn save_if_unchanged(pool: &SqlitePool, meeting_id: &str, expected_notes_json: &str, notes_json: &str, notes_markdown: &str) -> Result<(), String> {
    let blocks: Value = serde_json::from_str(notes_json).map_err(|_| "Invalid note content")?;
    if !blocks.is_array() { return Err("Invalid note content".into()); }
    let result = sqlx::query("UPDATE meeting_notes SET notes_json = ?, notes_markdown = ?, updated_at = ?
        WHERE meeting_id = ? AND notes_json = ? AND NOT EXISTS (SELECT 1 FROM meeting_trash WHERE meeting_id = ?)")
        .bind(notes_json).bind(notes_markdown).bind(chrono::Utc::now().to_rfc3339()).bind(meeting_id)
        .bind(expected_notes_json).bind(meeting_id).execute(pool).await.map_err(|e| format!("Could not save follow-up: {e}"))?;
    if result.rows_affected() == 0 { return Err("The source note changed or is unavailable. Refresh follow-ups before trying again.".into()); }
    Ok(())
}

#[tauri::command]
pub async fn save_meeting_notes_if_unchanged(state: tauri::State<'_, AppState>, meeting_id: String, expected_notes_json: String, notes_json: String, notes_markdown: String) -> Result<(), String> {
    save_if_unchanged(state.db_manager.pool(), &meeting_id, &expected_notes_json, &notes_json, &notes_markdown).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        for migration in [
            include_str!("../../migrations/20250916100000_initial_schema.sql"),
            include_str!("../../migrations/20251223000000_add_meeting_notes.sql"),
            include_str!("../../migrations/20260909120000_note_folders.sql"),
            include_str!("../../migrations/20260909190000_meeting_trash.sql"),
        ] { sqlx::raw_sql(migration).execute(&pool).await.unwrap(); }
        pool
    }

    async fn note(pool: &SqlitePool, id: &str, json: &str) {
        sqlx::query("INSERT INTO meetings VALUES (?, ?, '2026-09-09', '2026-09-09')").bind(id).bind(id).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO meeting_notes VALUES (?, 'original plain text', ?, '2026-09-09', 'revision1')")
            .bind(id).bind(json).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn original_nested_checkboxes_filter_by_status_folder_and_trash() {
        let pool = fixture().await;
        note(&pool, "A", r#"[{"id":"parent","type":"paragraph","children":[
            {"id":"open","type":"checkListItem","props":{"checked":false},"content":[{"type":"text","text":"Send "},{"type":"link","content":[{"type":"text","text":"results"}]}]},
            {"id":"done","type":"checkListItem","props":{"checked":true},"content":"Already sent"}]}]"#).await;
        note(&pool, "B", r#"[{"id":"other","type":"checkListItem","content":"Legacy text"}]"#).await;
        note(&pool, "invalid", "not JSON").await;
        note(&pool, "malformed", r#"[null,3,"text",{"id":"bad","type":"checkListItem","props":{"checked":"false"}}]"#).await;
        sqlx::query("INSERT INTO note_folders VALUES ('f', 'Folder', 'folder', '')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO note_folder_members VALUES ('f', 'A')").execute(&pool).await.unwrap();
        let page = list(&pool, false, Some("f"), 0).await.unwrap();
        assert_eq!(page.tasks.len(), 1);
        assert_eq!(page.tasks[0].text, "Send results");
        assert_eq!(page.tasks[0].revision, "revision1");
        let done = list(&pool, true, None, 0).await.unwrap();
        assert_eq!(done.tasks.len(), 1);
        assert_eq!(done.tasks[0].text, "Already sent");
        assert!(list(&pool, false, None, 0).await.unwrap().tasks.iter().any(|task| task.text == "Legacy text"));
        sqlx::query("INSERT INTO meeting_trash VALUES ('A', '')").execute(&pool).await.unwrap();
        assert!(list(&pool, true, None, 0).await.unwrap().tasks.is_empty());
        assert!(list(&pool, false, Some("f"), 0).await.unwrap().tasks.is_empty());
    }

    #[tokio::test]
    async fn pages_have_no_overlap_and_report_more_only_when_needed() {
        let pool = fixture().await;
        let blocks = (0..31).map(|i| serde_json::json!({"id":format!("b{i:02}"),"type":"checkListItem","content":format!("Task {i}")})).collect::<Vec<_>>();
        note(&pool, "A", &serde_json::to_string(&blocks).unwrap()).await;
        let first = list(&pool, false, None, -1).await.unwrap();
        let second = list(&pool, false, None, 30).await.unwrap();
        assert_eq!(first.tasks.len(), 30); assert!(first.has_more);
        assert_eq!(second.tasks.len(), 1); assert!(!second.has_more);
        assert!(first.tasks.iter().all(|task| task.block_id != second.tasks[0].block_id));
    }

    #[tokio::test]
    async fn compare_save_preserves_concurrent_edits_and_rejects_trashed_or_missing_notes() {
        let pool = fixture().await;
        let original = r#"[{"id":"task","type":"checkListItem","props":{"checked":false},"content":"Send results"}]"#;
        let changed = original.replace("false", "true");
        note(&pool, "A", original).await;
        save_if_unchanged(&pool, "A", original, &changed, "- [x] Send results").await.unwrap();
        assert!(save_if_unchanged(&pool, "A", original, "[]", "stale overwrite").await.is_err());
        let row = sqlx::query("SELECT notes_json, notes_markdown FROM meeting_notes WHERE meeting_id = 'A'").fetch_one(&pool).await.unwrap();
        assert_eq!(row.get::<String, _>("notes_json"), changed);
        assert_eq!(row.get::<String, _>("notes_markdown"), "- [x] Send results");
        assert!(save_if_unchanged(&pool, "A", &changed, "{}", "bad input").await.is_err());
        sqlx::query("INSERT INTO meeting_trash VALUES ('A', '')").execute(&pool).await.unwrap();
        assert!(save_if_unchanged(&pool, "A", &changed, original, "untrash").await.is_err());
        assert!(save_if_unchanged(&pool, "missing", original, &changed, "new note").await.is_err());
    }
}
