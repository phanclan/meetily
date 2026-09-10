use crate::state::AppState;
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NoteFolder { id: String, name: String, note_count: i64 }

fn folder_name(name: &str) -> Result<(&str, String), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Use a folder name of 1–80 characters, without line breaks.".into());
    }
    Ok((name, name.to_lowercase()))
}

fn write_error(error: sqlx::Error) -> String {
    if error.as_database_error().is_some_and(|error| error.is_unique_violation()) {
        "A folder with that name already exists.".into()
    } else { format!("Could not save the folder: {error}") }
}

async fn list(pool: &SqlitePool) -> Result<Vec<NoteFolder>, String> {
    sqlx::query_as("SELECT f.id, f.name, count(active.id) AS note_count FROM note_folders f
        LEFT JOIN note_folder_members m ON m.folder_id = f.id LEFT JOIN meetings active ON active.id = m.meeting_id AND NOT EXISTS(SELECT 1 FROM meeting_trash WHERE meeting_id = active.id) GROUP BY f.id ORDER BY f.name_key, f.id")
        .fetch_all(pool).await.map_err(|error| error.to_string())
}

async fn create(pool: &SqlitePool, name: &str, meeting_id: Option<&str>) -> Result<NoteFolder, String> {
    let (name, key) = folder_name(name)?;
    let id = uuid::Uuid::new_v4().to_string();
    let mut tx = pool.begin().await.map_err(write_error)?;
    if let Some(meeting_id) = meeting_id {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM meetings WHERE id = ?)")
            .bind(meeting_id).fetch_one(&mut *tx).await.map_err(write_error)?;
        if !exists { return Err("This note no longer exists.".into()); }
    }
    sqlx::query("INSERT INTO note_folders(id, name, name_key, created_at) VALUES (?, ?, ?, ?)")
        .bind(&id).bind(name).bind(key).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(write_error)?;
    if let Some(meeting_id) = meeting_id {
        sqlx::query("INSERT INTO note_folder_members(folder_id, meeting_id) VALUES (?, ?)")
            .bind(&id).bind(meeting_id).execute(&mut *tx).await.map_err(write_error)?;
    }
    tx.commit().await.map_err(write_error)?;
    Ok(NoteFolder { id, name: name.to_owned(), note_count: if meeting_id.is_some() { 1 } else { 0 } })
}

async fn rename(pool: &SqlitePool, id: &str, name: &str) -> Result<(), String> {
    let (name, key) = folder_name(name)?;
    let result = sqlx::query("UPDATE note_folders SET name = ?, name_key = ? WHERE id = ?")
        .bind(name).bind(key).bind(id).execute(pool).await.map_err(write_error)?;
    if result.rows_affected() == 0 { return Err("This folder no longer exists.".into()); }
    Ok(())
}

async fn members(pool: &SqlitePool, folder_id: &str) -> Result<Vec<String>, String> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM note_folders WHERE id = ?)")
        .bind(folder_id).fetch_one(pool).await.map_err(|error| error.to_string())?;
    if !exists { return Err("This folder no longer exists.".into()); }
    sqlx::query_scalar("SELECT meeting_id FROM note_folder_members WHERE folder_id = ? AND NOT EXISTS(SELECT 1 FROM meeting_trash t WHERE t.meeting_id = note_folder_members.meeting_id) ORDER BY meeting_id")
        .bind(folder_id).fetch_all(pool).await.map_err(|error| error.to_string())
}

async fn membership(pool: &SqlitePool, meeting_id: &str, folder_id: &str, included: bool) -> Result<(), String> {
    // Each change touches one association, so another window's folder choices survive.
    let mut tx = pool.begin().await.map_err(write_error)?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM meetings WHERE id = ?) AND EXISTS(SELECT 1 FROM note_folders WHERE id = ?)")
        .bind(meeting_id).bind(folder_id).fetch_one(&mut *tx).await.map_err(write_error)?;
    if !exists { return Err("The note or folder no longer exists.".into()); }
    if included {
        sqlx::query("INSERT INTO note_folder_members(folder_id, meeting_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
            .bind(folder_id).bind(meeting_id).execute(&mut *tx).await.map_err(write_error)?;
    } else {
        sqlx::query("DELETE FROM note_folder_members WHERE folder_id = ? AND meeting_id = ?")
            .bind(folder_id).bind(meeting_id).execute(&mut *tx).await.map_err(write_error)?;
    }
    tx.commit().await.map_err(write_error)
}

#[tauri::command]
pub async fn list_note_folders(state: tauri::State<'_, AppState>) -> Result<Vec<NoteFolder>, String> { list(state.db_manager.pool()).await }
#[tauri::command]
pub async fn create_note_folder(state: tauri::State<'_, AppState>, name: String, meeting_id: Option<String>) -> Result<NoteFolder, String> {
    create(state.db_manager.pool(), &name, meeting_id.as_deref()).await
}
#[tauri::command]
pub async fn rename_note_folder(state: tauri::State<'_, AppState>, folder_id: String, name: String) -> Result<(), String> {
    rename(state.db_manager.pool(), &folder_id, &name).await
}
#[tauri::command]
pub async fn get_note_folder_members(state: tauri::State<'_, AppState>, folder_id: String) -> Result<Vec<String>, String> {
    members(state.db_manager.pool(), &folder_id).await
}
#[tauri::command]
pub async fn get_meeting_note_folders(state: tauri::State<'_, AppState>, meeting_id: String) -> Result<Vec<String>, String> {
    sqlx::query_scalar("SELECT folder_id FROM note_folder_members WHERE meeting_id = ? ORDER BY folder_id")
        .bind(meeting_id).fetch_all(state.db_manager.pool()).await.map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn set_meeting_note_folder(state: tauri::State<'_, AppState>, meeting_id: String, folder_id: String, included: bool) -> Result<(), String> {
    membership(state.db_manager.pool(), &meeting_id, &folder_id, included).await
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20250916100000_initial_schema.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909120000_note_folders.sql")).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings VALUES ('A', 'Original note', '', ''), ('B', 'Another note', '', '')").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909190000_meeting_trash.sql")).execute(&pool).await.unwrap();
        pool
    }
    #[tokio::test]
    async fn trash_retains_memberships_but_excludes_folder_counts_and_contents() {
        let pool = fixture().await;
        let folder = create(&pool, "Recovery", Some("B")).await.unwrap();
        crate::meetnola::trash::trash(&pool, "B").await.unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].note_count, 0);
        assert!(members(&pool, &folder.id).await.unwrap().is_empty());
        crate::meetnola::trash::restore(&pool, "B").await.unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].note_count, 1);
        assert_eq!(members(&pool, &folder.id).await.unwrap(), vec!["B"]);
    }

    #[tokio::test]
    async fn creates_renames_and_counts_folders_without_changing_notes() {
        let pool = fixture().await;
        let folder = create(&pool, "  Project Alpha  ", Some("A")).await.unwrap();
        assert_eq!(folder.name, "Project Alpha");
        assert_eq!(members(&pool, &folder.id).await.unwrap(), vec!["A"]);
        assert_eq!(list(&pool).await.unwrap()[0].note_count, 1);
        assert!(create(&pool, "project ALPHA", None).await.is_err());
        let second = create(&pool, "Other", None).await.unwrap();
        assert!(rename(&pool, &second.id, "PROJECT ALPHA").await.is_err());
        rename(&pool, &folder.id, "Renamed project").await.unwrap();
        assert!(list(&pool).await.unwrap().iter().any(|f| f.name == "Renamed project" && f.note_count == 1));
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT title FROM meetings WHERE id = 'A'").fetch_one(&pool).await.unwrap(), "Original note");
        assert!(rename(&pool, "missing", "New name").await.is_err());
    }
    #[tokio::test]
    async fn membership_is_idempotent_independent_and_cascades_on_note_deletion() {
        let pool = fixture().await;
        let first = create(&pool, "First", None).await.unwrap();
        let second = create(&pool, "Second", None).await.unwrap();
        for _ in 0..2 { membership(&pool, "A", &first.id, true).await.unwrap(); }
        membership(&pool, "A", &second.id, true).await.unwrap();
        membership(&pool, "B", &first.id, true).await.unwrap();
        membership(&pool, "A", &first.id, false).await.unwrap();
        assert_eq!(members(&pool, &first.id).await.unwrap(), vec!["B"]);
        assert_eq!(members(&pool, &second.id).await.unwrap(), vec!["A"]);
        assert!(membership(&pool, "missing", &first.id, true).await.is_err());
        assert!(membership(&pool, "A", "missing", false).await.is_err());
        assert!(create(&pool, "Should roll back", Some("missing")).await.is_err());
        assert_eq!(list(&pool).await.unwrap().len(), 2);
        sqlx::query("DELETE FROM meetings WHERE id = 'A'").execute(&pool).await.unwrap();
        assert!(members(&pool, &second.id).await.unwrap().is_empty());
        assert_eq!(list(&pool).await.unwrap().len(), 2);
    }
    #[test]
    fn bounds_folder_names() {
        for name in ["", "  ", "a\nb", &"x".repeat(81)] { assert!(folder_name(name).is_err()); }
        assert_eq!(folder_name(" CAFÉ ").unwrap().1, "café");
    }
}
