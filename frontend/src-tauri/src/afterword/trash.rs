use crate::{database::repositories::meeting::MeetingsRepository, state::AppState, summary::service::SummaryService};
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TrashedMeeting { id: String, title: String, trashed_at: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashPage { meetings: Vec<TrashedMeeting>, has_more: bool }

pub(crate) async fn trash(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let _job = SummaryService::try_start_summary(id)?;
    let result = sqlx::query("INSERT INTO meeting_trash(meeting_id, trashed_at) SELECT id, ? FROM meetings WHERE id = ? ON CONFLICT(meeting_id) DO UPDATE SET meeting_id = excluded.meeting_id")
        .bind(chrono::Utc::now().to_rfc3339()).bind(id).execute(pool).await.map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 { return Err("This note no longer exists.".into()); }
    Ok(())
}

pub(crate) async fn restore(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM meetings WHERE id = ?)")
        .bind(id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
    if !exists { return Err("This note was permanently deleted.".into()); }
    sqlx::query("DELETE FROM meeting_trash WHERE meeting_id = ?").bind(id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

async fn list(pool: &SqlitePool, offset: u32) -> Result<TrashPage, String> {
    let mut meetings: Vec<TrashedMeeting> = sqlx::query_as("SELECT m.id, m.title, t.trashed_at FROM meeting_trash t JOIN meetings m ON m.id = t.meeting_id ORDER BY t.trashed_at DESC, t.meeting_id DESC LIMIT 51 OFFSET ?")
        .bind(offset).fetch_all(pool).await.map_err(|e| e.to_string())?;
    let has_more = meetings.len() > 50;
    meetings.truncate(50);
    Ok(TrashPage { meetings, has_more })
}

async fn purge(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let _job = SummaryService::try_start_summary(id)?;
    if !MeetingsRepository::delete_meeting(pool, id).await.map_err(|e| e.to_string())? {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM meetings WHERE id = ?)")
            .bind(id).fetch_one(pool).await.map_err(|e| e.to_string())?;
        if exists { return Err("Move the note to Trash before deleting it permanently.".into()); }
    }
    Ok(())
}

#[tauri::command]
pub async fn trash_meeting(state: tauri::State<'_, AppState>, meeting_id: String) -> Result<(), String> { trash(state.db_manager.pool(), &meeting_id).await }
#[tauri::command]
pub async fn restore_trashed_meeting(state: tauri::State<'_, AppState>, meeting_id: String) -> Result<(), String> { restore(state.db_manager.pool(), &meeting_id).await }
#[tauri::command]
pub async fn list_trashed_meetings(state: tauri::State<'_, AppState>, offset: u32) -> Result<TrashPage, String> { list(state.db_manager.pool(), offset).await }
#[tauri::command]
pub async fn delete_trashed_meeting(state: tauri::State<'_, AppState>, meeting_id: String) -> Result<(), String> { purge(state.db_manager.pool(), &meeting_id).await }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::{notes::NotesRepository, transcript::TranscriptsRepository};

    async fn fixture() -> (SqlitePool, String) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO meetings(id,title,created_at,updated_at,folder_path) VALUES (?, 'Synthetic recovery', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', '/synthetic/recording')")
            .bind(&id).execute(&pool).await.unwrap();
        NotesRepository::save_notes(&pool, &id, Some("Original written requirement"), Some("[]")).await.unwrap();
        for query in [
            "INSERT INTO transcripts(id,meeting_id,transcript,timestamp) VALUES ('t', ?, 'Original speech', '00:01')",
            "INSERT INTO transcript_chunks(meeting_id,transcript_text,model,model_name,created_at) VALUES (?, 'Original speech', 'local', 'synthetic', '')",
            "INSERT INTO summary_processes(meeting_id,status,created_at,updated_at,result) VALUES (?, 'completed', '', '', '{\"markdown\":\"Current enhancement\"}')",
            "INSERT INTO previous_summaries(meeting_id,version_id,result,saved_at) VALUES (?, 'v1', '{\"markdown\":\"Previous enhancement\"}', '')",
            "INSERT INTO meeting_chat(meeting_id,messages_json) VALUES (?, '[]')",
        ] { sqlx::query(query).bind(&id).execute(&pool).await.unwrap(); }
        sqlx::raw_sql("INSERT INTO note_folders VALUES ('f', 'Review', 'review', '');").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO note_folder_members VALUES ('f', ?)").bind(&id).execute(&pool).await.unwrap();
        (pool, id)
    }

    async fn snapshot(pool: &SqlitePool) -> Vec<String> {
        let mut rows = vec![];
        for query in [
            "SELECT json_array(id,title,created_at,updated_at,folder_path) FROM meetings",
            "SELECT json_array(meeting_id,notes_markdown,notes_json) FROM meeting_notes",
            "SELECT json_array(meeting_id,transcript,timestamp) FROM transcripts",
            "SELECT json_array(meeting_id,transcript_text) FROM transcript_chunks",
            "SELECT json_array(meeting_id,status,result) FROM summary_processes",
            "SELECT json_array(meeting_id,version_id,result) FROM previous_summaries",
            "SELECT json_array(meeting_id,messages_json) FROM meeting_chat",
            "SELECT json_array(meeting_id,folder_id) FROM note_folder_members",
            "SELECT json_array(meeting_id,kind,body) FROM library_documents ORDER BY id",
        ] { rows.extend(sqlx::query_scalar::<_, String>(query).fetch_all(pool).await.unwrap()); }
        rows
    }

    #[tokio::test]
    async fn trash_restore_preserves_all_note_data_and_retries() {
        let (pool, id) = fixture().await;
        let before = snapshot(&pool).await;
        trash(&pool, &id).await.unwrap();
        let first_time = list(&pool, 0).await.unwrap().meetings[0].trashed_at.clone();
        trash(&pool, &id).await.unwrap();
        assert_eq!(list(&pool, 0).await.unwrap().meetings[0].trashed_at, first_time);
        assert!(MeetingsRepository::get_meetings(&pool).await.unwrap().is_empty());
        assert!(MeetingsRepository::get_meeting_metadata(&pool, &id).await.unwrap().is_none());
        assert!(NotesRepository::get_notes(&pool, &id).await.unwrap().is_none());
        assert!(TranscriptsRepository::search_transcripts(&pool, "Original speech").await.unwrap().is_empty());
        assert_eq!(snapshot(&pool).await, before);
        restore(&pool, &id).await.unwrap();
        restore(&pool, &id).await.unwrap();
        assert!(list(&pool, 0).await.unwrap().meetings.is_empty());
        assert_eq!(MeetingsRepository::get_meetings(&pool).await.unwrap().len(), 1);
        assert!(NotesRepository::get_notes(&pool, &id).await.unwrap().is_some());
        assert_eq!(TranscriptsRepository::search_transcripts(&pool, "Original speech").await.unwrap().len(), 1);
        assert_eq!(snapshot(&pool).await, before);
    }

    #[tokio::test]
    async fn trash_purge_requires_trash_and_cascades_only_after_success() {
        let (pool, id) = fixture().await;
        assert!(purge(&pool, &id).await.unwrap_err().contains("Move the note"));
        trash(&pool, &id).await.unwrap();
        let before = snapshot(&pool).await;
        sqlx::raw_sql("CREATE TRIGGER fail_delete BEFORE DELETE ON meetings BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END;")
            .execute(&pool).await.unwrap();
        assert!(purge(&pool, &id).await.is_err());
        assert_eq!(snapshot(&pool).await, before);
        assert_eq!(list(&pool, 0).await.unwrap().meetings.len(), 1);
        sqlx::query("DROP TRIGGER fail_delete").execute(&pool).await.unwrap();
        purge(&pool, &id).await.unwrap();
        purge(&pool, &id).await.unwrap();
        assert!(snapshot(&pool).await.is_empty());
        assert!(list(&pool, 0).await.unwrap().meetings.is_empty());
        assert!(restore(&pool, &id).await.unwrap_err().contains("permanently deleted"));
        assert!(trash(&pool, &id).await.is_err());
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM note_folders").fetch_one(&pool).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn trash_and_restore_storage_failures_are_retryable() {
        let (pool, id) = fixture().await;
        sqlx::raw_sql("CREATE TRIGGER fail_trash BEFORE INSERT ON meeting_trash BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;")
            .execute(&pool).await.unwrap();
        assert!(trash(&pool, &id).await.is_err());
        assert_eq!(MeetingsRepository::get_meetings(&pool).await.unwrap().len(), 1);
        sqlx::query("DROP TRIGGER fail_trash").execute(&pool).await.unwrap();
        trash(&pool, &id).await.unwrap();
        sqlx::raw_sql("CREATE TRIGGER fail_restore BEFORE DELETE ON meeting_trash BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;")
            .execute(&pool).await.unwrap();
        assert!(restore(&pool, &id).await.is_err());
        assert_eq!(list(&pool, 0).await.unwrap().meetings.len(), 1);
        sqlx::query("DROP TRIGGER fail_restore").execute(&pool).await.unwrap();
        restore(&pool, &id).await.unwrap();
    }

    #[tokio::test]
    async fn trash_changes_refuse_an_active_enhancement() {
        let (pool, id) = fixture().await;
        let job = SummaryService::try_start_summary(&id).unwrap();
        assert!(trash(&pool, &id).await.is_err());
        drop(job);
        trash(&pool, &id).await.unwrap();
        let job = SummaryService::try_start_summary(&id).unwrap();
        assert!(purge(&pool, &id).await.is_err());
        drop(job);
        restore(&pool, &id).await.unwrap();
    }

    #[tokio::test]
    async fn trash_pages_with_a_stable_tie_breaker() {
        let (pool, _) = fixture().await;
        for i in 0..53 {
            let id = format!("page-{i:02}");
            sqlx::query("INSERT INTO meetings(id,title,created_at,updated_at) VALUES (?, 'Synthetic', '', '')").bind(&id).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO meeting_trash VALUES (?, '2026-09-09')").bind(&id).execute(&pool).await.unwrap();
        }
        let first = list(&pool, 0).await.unwrap();
        let second = list(&pool, 50).await.unwrap();
        assert_eq!((first.meetings.len(), second.meetings.len()), (50, 3));
        assert!(first.has_more && !second.has_more);
        assert_eq!(first.meetings[0].id, "page-52");
        assert_eq!(second.meetings[0].id, "page-02");
        assert!(list(&pool, u32::MAX).await.unwrap().meetings.is_empty());
    }
}
