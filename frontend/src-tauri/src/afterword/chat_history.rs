use crate::state::AppState;
use sqlx::SqlitePool;

/// Run inside the transcript save transaction, including idempotent save retries.
pub async fn attach_recording_chat(conn: &mut sqlx::SqliteConnection, recording_id: &str, meeting_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO meeting_chat (meeting_id, messages_json) SELECT ?, messages_json FROM recording_chat WHERE recording_id = ? AND meeting_id IS NULL ON CONFLICT(meeting_id) DO NOTHING")
        .bind(meeting_id).bind(recording_id).execute(&mut *conn).await?;
    sqlx::query("INSERT INTO recording_chat (recording_id, meeting_id, messages_json) VALUES (?, ?, NULL) ON CONFLICT(recording_id) DO UPDATE SET meeting_id = excluded.meeting_id, messages_json = NULL")
        .bind(recording_id).bind(meeting_id).execute(conn).await?;
    Ok(())
}

async fn save_recording(pool: &SqlitePool, recording_id: &str, messages_json: &str) -> Result<(), String> {
    if recording_id.trim().is_empty() || recording_id.len() > 256 { return Err("Invalid recording ID".into()); }
    parse_messages(messages_json)?;
    let mut transaction = pool.begin().await.map_err(|e| e.to_string())?;
    // Acquire the write lock before resolving the destination. A Stop/save cannot
    // promote the conversation between this lookup and the following write.
    sqlx::query("INSERT INTO recording_chat (recording_id, messages_json) VALUES (?, '[]') ON CONFLICT(recording_id) DO NOTHING")
        .bind(recording_id).execute(&mut *transaction).await.map_err(|e| e.to_string())?;
    let meeting_id: Option<String> = sqlx::query_scalar("SELECT meeting_id FROM recording_chat WHERE recording_id = ?")
        .bind(recording_id).fetch_one(&mut *transaction).await.map_err(|e| e.to_string())?;
    if let Some(meeting_id) = meeting_id {
        sqlx::query("INSERT INTO meeting_chat (meeting_id, messages_json) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM meetings WHERE id = ?) ON CONFLICT(meeting_id) DO UPDATE SET messages_json = excluded.messages_json")
            .bind(&meeting_id).bind(messages_json).bind(&meeting_id).execute(&mut *transaction).await.map_err(|e| e.to_string())?;
    } else {
        sqlx::query("UPDATE recording_chat SET messages_json = ? WHERE recording_id = ?")
            .bind(messages_json).bind(recording_id).execute(&mut *transaction).await.map_err(|e| e.to_string())?;
    }
    transaction.commit().await.map_err(|e| e.to_string())
}

async fn read_recording(pool: &SqlitePool, recording_id: &str) -> Result<Option<String>, String> {
    let row: Option<Option<String>> = sqlx::query_scalar("SELECT CASE WHEN r.meeting_id IS NULL THEN r.messages_json ELSE c.messages_json END FROM recording_chat r LEFT JOIN meeting_chat c ON c.meeting_id = r.meeting_id WHERE r.recording_id = ?")
        .bind(recording_id).fetch_optional(pool).await.map_err(|e| e.to_string())?;
    Ok(row.flatten())
}

#[tauri::command]
pub async fn save_recording_chat(state: tauri::State<'_, AppState>, recording_id: String, messages_json: String) -> Result<(), String> {
    save_recording(state.db_manager.pool(), &recording_id, &messages_json).await
}

#[tauri::command]
pub async fn get_recording_chat(state: tauri::State<'_, AppState>, recording_id: String) -> Result<Option<String>, String> {
    read_recording(state.db_manager.pool(), &recording_id).await
}

#[tauri::command]
pub async fn discard_recording_chat(state: tauri::State<'_, AppState>, recording_id: String) -> Result<(), String> {
    discard_recording(state.db_manager.pool(), &recording_id).await
}

async fn discard_recording(pool: &SqlitePool, recording_id: &str) -> Result<(), String> {
    // An empty destination is a content-free discard marker. Do not erase a
    // conversation already attached to a saved meeting during recovery retry.
    sqlx::query("INSERT INTO recording_chat (recording_id, meeting_id, messages_json) VALUES (?, '', NULL) ON CONFLICT(recording_id) DO UPDATE SET meeting_id = '', messages_json = NULL WHERE recording_chat.meeting_id IS NULL")
        .bind(recording_id).execute(pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn parse_messages(messages_json: &str) -> Result<Vec<serde_json::Value>, String> {
    if messages_json.len() > 16 * 1024 * 1024 {
        return Err("Conversation exceeds the 16 MB storage limit".into());
    }
    let messages: Vec<serde_json::Value> = serde_json::from_str(messages_json)
        .map_err(|_| "Invalid meeting conversation".to_string())?;
    if messages.iter().any(|message| {
        !matches!(message["role"].as_str(), Some("user" | "assistant"))
            || !message["content"].is_string()
    }) {
        return Err("Meeting conversation is invalid or exceeds the 16 MB storage limit".into());
    }
    Ok(messages)
}

async fn save(pool: &SqlitePool, meeting_id: &str, messages_json: &str) -> Result<(), String> {
    parse_messages(messages_json)?;
    // Late queued writes after deletion must neither recreate data nor block app quit.
    sqlx::query("INSERT INTO meeting_chat (meeting_id, messages_json) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM meetings WHERE id = ?) ON CONFLICT(meeting_id) DO UPDATE SET messages_json = excluded.messages_json")
        .bind(meeting_id).bind(messages_json).bind(meeting_id).execute(pool).await
        .map_err(|error| format!("Could not save meeting conversation: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn save_meeting_chat(state: tauri::State<'_, AppState>, meeting_id: String, messages_json: String) -> Result<(), String> {
    save(state.db_manager.pool(), &meeting_id, &messages_json).await
}

#[tauri::command]
pub async fn get_meeting_chat(state: tauri::State<'_, AppState>, meeting_id: String) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT messages_json FROM meeting_chat WHERE meeting_id = ?")
        .bind(meeting_id).fetch_optional(state.db_manager.pool()).await
        .map_err(|error| format!("Could not load meeting conversation: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn recording_database() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn discarding_recovery_removes_only_unattached_conversations() {
        use crate::database::repositories::transcript::TranscriptsRepository;
        let pool = recording_database().await;
        let answer = r#"[{"role":"assistant","content":"Synthetic"}]"#;
        save_recording(&pool, "discard", answer).await.unwrap();
        discard_recording(&pool, "discard").await.unwrap();
        save_recording(&pool, "discard", answer).await.unwrap();
        assert!(read_recording(&pool, "discard").await.unwrap().is_none());
        discard_recording(&pool, "never-written").await.unwrap();
        save_recording(&pool, "never-written", answer).await.unwrap();
        assert!(read_recording(&pool, "never-written").await.unwrap().is_none());
        save_recording(&pool, "saved", answer).await.unwrap();
        TranscriptsRepository::save_transcript(&pool, "Synthetic", &[], None, Some("saved")).await.unwrap();
        discard_recording(&pool, "saved").await.unwrap();
        assert_eq!(read_recording(&pool, "saved").await.unwrap().as_deref(), Some(answer));
    }

    #[tokio::test]
    async fn recording_chat_promotes_with_sources_and_routes_late_answers() {
        use crate::database::repositories::transcript::TranscriptsRepository;
        let pool = recording_database().await;
        let question = r#"[{"role":"user","content":"Who owns it?"}]"#;
        let answer = r#"[{"role":"user","content":"Who owns it?"},{"role":"assistant","content":"Morgan [S1](#source-S1)","sources":[{"id":"S1","label":"Written notes","text":"Morgan will send results Friday."}]}]"#;
        save_recording(&pool, "meeting-123", question).await.unwrap();
        assert_eq!(read_recording(&pool, "meeting-123").await.unwrap().as_deref(), Some(question));
        assert!(read_recording(&pool, "meeting-other").await.unwrap().is_none());
        let id = TranscriptsRepository::save_transcript(&pool, "Synthetic", &[], None, Some("meeting-123")).await.unwrap();
        let stored: String = sqlx::query_scalar("SELECT messages_json FROM meeting_chat WHERE meeting_id = ?").bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(stored, question);
        save_recording(&pool, "meeting-123", answer).await.unwrap();
        assert_eq!(read_recording(&pool, "meeting-123").await.unwrap().as_deref(), Some(answer));
        let stored: String = sqlx::query_scalar("SELECT messages_json FROM meeting_chat WHERE meeting_id = ?").bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(stored, answer);
        // Repeating Stop must not replace a conversation edited in the saved view.
        save(&pool, &id, question).await.unwrap();
        TranscriptsRepository::save_transcript(&pool, "Synthetic", &[], None, Some("meeting-123")).await.unwrap();
        assert_eq!(read_recording(&pool, "meeting-123").await.unwrap().as_deref(), Some(question));
        let duplicate: Option<String> = sqlx::query_scalar("SELECT messages_json FROM recording_chat WHERE recording_id = 'meeting-123'").fetch_one(&pool).await.unwrap();
        assert!(duplicate.is_none());
        sqlx::query("DELETE FROM meetings WHERE id = ?").bind(&id).execute(&pool).await.unwrap();
        save_recording(&pool, "meeting-123", answer).await.unwrap();
        assert!(read_recording(&pool, "meeting-123").await.unwrap().is_none());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting_chat").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn recording_chat_survives_failed_stop_and_rejects_invalid_overwrites() {
        use crate::database::repositories::transcript::TranscriptsRepository;
        let pool = recording_database().await;
        let answer = r#"[{"role":"assistant","content":"Original","notice":"Response interrupted. This answer is incomplete."}]"#;
        save_recording(&pool, "meeting-456", answer).await.unwrap();
        sqlx::raw_sql("CREATE TRIGGER reject_chat BEFORE INSERT ON meeting_chat BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").execute(&pool).await.unwrap();
        assert!(TranscriptsRepository::save_transcript(&pool, "Synthetic", &[], None, Some("meeting-456")).await.is_err());
        assert_eq!(read_recording(&pool, "meeting-456").await.unwrap().as_deref(), Some(answer));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meetings").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0);
        assert!(save_recording(&pool, "meeting-456", "invalid").await.is_err());
        assert_eq!(read_recording(&pool, "meeting-456").await.unwrap().as_deref(), Some(answer));
        sqlx::raw_sql("DROP TRIGGER reject_chat").execute(&pool).await.unwrap();
        TranscriptsRepository::save_transcript(&pool, "Synthetic", &[], None, Some("meeting-456")).await.unwrap();
        assert_eq!(read_recording(&pool, "meeting-456").await.unwrap().as_deref(), Some(answer));
    }

    #[tokio::test]
    async fn first_recording_question_can_finish_after_transcript_save() {
        use crate::database::repositories::transcript::TranscriptsRepository;
        let pool = recording_database().await;
        let id = TranscriptsRepository::save_transcript(&pool, "Synthetic", &[], None, Some("meeting-789")).await.unwrap();
        save_recording(&pool, "meeting-789", r#"[{"role":"assistant","content":"Late answer"}]"#).await.unwrap();
        let stored: String = sqlx::query_scalar("SELECT messages_json FROM meeting_chat WHERE meeting_id = ?").bind(&id).fetch_one(&pool).await.unwrap();
        assert!(stored.contains("Late answer"));
    }

    #[tokio::test]
    async fn conversation_is_isolated_durable_and_deleted_with_its_meeting() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();
        sqlx::query("CREATE TABLE meetings (id TEXT PRIMARY KEY)").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909001000_meeting_chat.sql")).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings VALUES ('A'), ('B')").execute(&pool).await.unwrap();
        let messages = r#"[{"role":"user","content":"Synthetic question"},{"role":"assistant","content":"Keep the title"}]"#;
        save(&pool, "A", messages).await.unwrap();
        let stored: String = sqlx::query_scalar("SELECT messages_json FROM meeting_chat WHERE meeting_id = 'A'").fetch_one(&pool).await.unwrap();
        assert_eq!(stored, messages);
        let other: Option<String> = sqlx::query_scalar("SELECT messages_json FROM meeting_chat WHERE meeting_id = 'B'").fetch_optional(&pool).await.unwrap();
        assert!(other.is_none());
        save(&pool, "missing", messages).await.unwrap();
        assert!(save(&pool, "A", r#"[{"role":"system","content":"invalid"}]"#).await.is_err());
        sqlx::query("DELETE FROM meetings WHERE id = 'A'").execute(&pool).await.unwrap();
        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting_chat").fetch_one(&pool).await.unwrap();
        assert_eq!(remaining, 0);
        save(&pool, "A", messages).await.unwrap();
        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meeting_chat").fetch_one(&pool).await.unwrap();
        assert_eq!(remaining, 0);
    }
}
