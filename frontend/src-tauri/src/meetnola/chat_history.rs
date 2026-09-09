use crate::state::AppState;
use sqlx::SqlitePool;

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
