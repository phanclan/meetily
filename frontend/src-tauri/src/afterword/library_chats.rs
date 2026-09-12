use crate::state::AppState;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};

fn valid_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map(|_| ()).map_err(|_| "Invalid conversation ID".into())
}

async fn save(pool: &SqlitePool, id: &str, json: &str) -> Result<(), String> {
    valid_id(id)?;
    let mut messages = super::chat_history::parse_messages(json)?;
    let title = messages.iter().find(|message| message["role"] == "user")
        .and_then(|message| message["content"].as_str())
        .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect::<String>());
    let mut transaction = pool.begin().await.map_err(|e| e.to_string())?;
    let mut source_ids = HashSet::new();
    let mut source_exists = HashMap::new();
    for message in &mut messages {
        let mut missing = false;
        let mut message_sources = Vec::new();
        if let Some(ids) = message["sourceMeetingIds"].as_array() {
            for id in ids { message_sources.push(id.as_str().ok_or("Invalid source meeting ID")?.to_owned()); }
        }
        if let Some(sources) = message["sources"].as_array() {
            for source in sources {
                let meeting_id = source["meetingId"].as_str().ok_or("Library citations need a source meeting")?;
                message_sources.push(meeting_id.to_owned());
            }
        }
        for meeting_id in &message_sources {
            let exists = if let Some(exists) = source_exists.get(meeting_id) { *exists } else {
                let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM meetings WHERE id = ?)")
                    .bind(meeting_id).fetch_one(&mut *transaction).await.map_err(|e| e.to_string())?;
                source_exists.insert(meeting_id.to_owned(), exists);
                exists
            };
            if !exists { missing = true; }
        }
        if missing {
            // A late save must not restore the copied text removed by the deletion trigger.
            *message = serde_json::json!({"role":"assistant", "content":"", "notice":"A source meeting was deleted. This answer is no longer available."});
        } else {
            source_ids.extend(message_sources);
        }
    }
    let stored = serde_json::to_string(&messages).map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO library_chats(id, title, messages_json, updated_at)
        SELECT ?, COALESCE(?, 'New conversation'), ?, ? WHERE ? <> '[]'
        ON CONFLICT(id) DO UPDATE SET messages_json = excluded.messages_json,
          title = COALESCE(?, library_chats.title), updated_at = excluded.updated_at WHERE library_chats.archived = 0")
        .bind(id).bind(&title).bind(&stored).bind(chrono::Utc::now().to_rfc3339()).bind(&stored).bind(&title)
        .execute(&mut *transaction).await.map_err(|e| e.to_string())?;
    // Empty snapshots clear an existing chat without creating an empty history entry.
    if messages.is_empty() {
        sqlx::query("UPDATE library_chats SET messages_json = '[]' WHERE id = ? AND archived = 0")
            .bind(id).execute(&mut *transaction).await.map_err(|e| e.to_string())?;
    }
    let archived: Option<bool> = sqlx::query_scalar("SELECT archived FROM library_chats WHERE id = ?")
        .bind(id).fetch_optional(&mut *transaction).await.map_err(|e| e.to_string())?;
    if archived == Some(false) {
        sqlx::query("DELETE FROM library_chat_sources WHERE chat_id = ?").bind(id)
            .execute(&mut *transaction).await.map_err(|e| e.to_string())?;
        for meeting_id in source_ids {
            sqlx::query("INSERT INTO library_chat_sources(chat_id, meeting_id) VALUES (?, ?)")
                .bind(id).bind(meeting_id).execute(&mut *transaction).await.map_err(|e| e.to_string())?;
        }
    }
    transaction.commit().await.map_err(|e| e.to_string())
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChatSettings { draft: String, period: String, source_scope: String, archived: bool }

async fn save_settings(pool: &SqlitePool, id: &str, draft: &str, period: &str, source_scope: &str) -> Result<(), String> {
    valid_id(id)?;
    if draft.len() > 128 * 1024 || !matches!(period, "all" | "7" | "30" | "90") || !matches!(source_scope, "keywords" | "recent") {
        return Err("Invalid source scope/date range or draft exceeds 128 KB".into());
    }
    let title: String = draft.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
    sqlx::query("INSERT INTO library_chats(id, title, draft, period, source_scope, updated_at)
        SELECT ?, COALESCE(NULLIF(?, ''), 'New conversation'), ?, ?, ?, ? WHERE ? <> '' OR ? <> 'all' OR ? <> 'keywords'
        ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, period = excluded.period, source_scope = excluded.source_scope,
          title = CASE WHEN library_chats.messages_json = '[]' AND excluded.draft <> '' THEN excluded.title ELSE library_chats.title END,
          updated_at = excluded.updated_at WHERE library_chats.archived = 0")
        .bind(id).bind(title).bind(draft).bind(period).bind(source_scope).bind(chrono::Utc::now().to_rfc3339()).bind(draft).bind(period).bind(source_scope)
        .execute(pool).await.map_err(|e| e.to_string())?;
    if draft.is_empty() && period == "all" && source_scope == "keywords" {
        sqlx::query("UPDATE library_chats SET draft = '', period = 'all', source_scope = 'keywords' WHERE id = ? AND archived = 0")
            .bind(id).execute(pool).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn save_library_chat(state: tauri::State<'_, AppState>, chat_id: String, messages_json: String) -> Result<(), String> {
    save(state.db_manager.pool(), &chat_id, &messages_json).await
}
#[tauri::command]
pub async fn get_library_chat(state: tauri::State<'_, AppState>, chat_id: String) -> Result<Option<String>, String> {
    valid_id(&chat_id)?;
    sqlx::query_scalar("SELECT messages_json FROM library_chats WHERE id = ?").bind(chat_id)
        .fetch_optional(state.db_manager.pool()).await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn save_library_chat_settings(state: tauri::State<'_, AppState>, chat_id: String, draft: String, period: String, source_scope: String) -> Result<(), String> {
    save_settings(state.db_manager.pool(), &chat_id, &draft, &period, &source_scope).await
}
#[tauri::command]
pub async fn get_library_chat_settings(state: tauri::State<'_, AppState>, chat_id: String) -> Result<ChatSettings, String> {
    valid_id(&chat_id)?;
    Ok(sqlx::query_as("SELECT draft, period, source_scope, archived FROM library_chats WHERE id = ?").bind(chat_id)
        .fetch_optional(state.db_manager.pool()).await.map_err(|e| e.to_string())?
        .unwrap_or(ChatSettings { draft: String::new(), period: "all".into(), source_scope: "keywords".into(), archived: false }))
}
#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChatListItem { id: String, title: String, updated_at: String }
#[tauri::command]
pub async fn list_library_chats(state: tauri::State<'_, AppState>, archived: bool, offset: u32) -> Result<Vec<ChatListItem>, String> {
    sqlx::query_as("SELECT id, title, updated_at FROM library_chats WHERE archived = ? ORDER BY updated_at DESC, id LIMIT 30 OFFSET ?")
        .bind(archived).bind(offset).fetch_all(state.db_manager.pool()).await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn set_library_chat_archived(state: tauri::State<'_, AppState>, chat_id: String, archived: bool) -> Result<(), String> {
    valid_id(&chat_id)?;
    sqlx::query("UPDATE library_chats SET archived = ?, updated_at = ? WHERE id = ?")
        .bind(archived).bind(chrono::Utc::now().to_rfc3339()).bind(chat_id)
        .execute(state.db_manager.pool()).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIRST: &str = "00000000-0000-4000-8000-000000000001";
    const SECOND: &str = "00000000-0000-4000-8000-000000000002";
    async fn fixture() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("PRAGMA foreign_keys = ON; CREATE TABLE meetings(id TEXT PRIMARY KEY); INSERT INTO meetings VALUES ('A'), ('B');")
            .execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909020000_library_chats.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909210000_library_recent_scope.sql")).execute(&pool).await.unwrap();
        pool
    }
    async fn read(pool: &SqlitePool, id: &str) -> serde_json::Value {
        let text: String = sqlx::query_scalar("SELECT messages_json FROM library_chats WHERE id = ?").bind(id).fetch_one(pool).await.unwrap();
        serde_json::from_str(&text).unwrap()
    }
    #[tokio::test]
    async fn source_scope_saves_without_a_draft_and_archived_settings_stay_unchanged() {
        let pool = fixture().await;
        save_settings(&pool, FIRST, "", "all", "recent").await.unwrap();
        let scope: String = sqlx::query_scalar("SELECT source_scope FROM library_chats WHERE id = ?").bind(FIRST).fetch_one(&pool).await.unwrap();
        assert_eq!(scope, "recent");
        sqlx::query("UPDATE library_chats SET archived = 1 WHERE id = ?").bind(FIRST).execute(&pool).await.unwrap();
        save_settings(&pool, FIRST, "", "all", "keywords").await.unwrap();
        let scope: String = sqlx::query_scalar("SELECT source_scope FROM library_chats WHERE id = ?").bind(FIRST).fetch_one(&pool).await.unwrap();
        assert_eq!(scope, "recent");
        assert!(save_settings(&pool, FIRST, "", "all", "invalid").await.is_err());
    }

    #[tokio::test]
    async fn messages_and_drafts_are_isolated_and_archive_preserves_them() {
        let pool = fixture().await;
        save(&pool, FIRST, "[]").await.unwrap();
        save_settings(&pool, FIRST, "", "all", "keywords").await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM library_chats").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0);
        save_settings(&pool, FIRST, "Unsent follow-up", "30", "keywords").await.unwrap();
        let draft_title: String = sqlx::query_scalar("SELECT title FROM library_chats WHERE id = ?").bind(FIRST).fetch_one(&pool).await.unwrap();
        assert_eq!(draft_title, "Unsent follow-up");
        save(&pool, FIRST, r#"[{"role":"user","content":"What changed in Comet?"},{"role":"assistant","content":"Synthetic answer"}]"#).await.unwrap();
        save(&pool, SECOND, r#"[{"role":"user","content":"Independent second conversation"}]"#).await.unwrap();
        let row: (String, String, String) = sqlx::query_as("SELECT title, draft, period FROM library_chats WHERE id = ?").bind(FIRST).fetch_one(&pool).await.unwrap();
        assert_eq!(row, ("What changed in Comet?".into(), "Unsent follow-up".into(), "30".into()));
        sqlx::query("UPDATE library_chats SET archived = 1 WHERE id = ?").bind(FIRST).execute(&pool).await.unwrap();
        save(&pool, FIRST, "[]").await.unwrap();
        save_settings(&pool, FIRST, "late draft", "7", "keywords").await.unwrap();
        assert_eq!(read(&pool, FIRST).await.as_array().unwrap().len(), 2);
        sqlx::query("UPDATE library_chats SET archived = 0 WHERE id = ?").bind(FIRST).execute(&pool).await.unwrap();
        save(&pool, FIRST, "[]").await.unwrap();
        assert_eq!(read(&pool, FIRST).await, serde_json::json!([]));
        assert_eq!(read(&pool, SECOND).await[0]["content"], "Independent second conversation");
        assert!(save(&pool, "bad-id", "[]").await.is_err());
        assert!(save_settings(&pool, FIRST, "draft", "invalid", "keywords").await.is_err());
    }
    #[tokio::test]
    async fn deleting_a_source_redacts_only_affected_answers_and_late_writes_cannot_restore_it() {
        let pool = fixture().await;
        let messages = serde_json::json!([
            {"role":"user", "content":"Synthetic question"},
            {"role":"assistant", "content":"Copied fact A", "sources":[{"id":"S1", "meetingId":"A", "label":"A", "text":"Original A"}]},
            {"role":"user", "content":"Second question"},
            {"role":"assistant", "content":"Copied fact B", "sources":[{"id":"S1", "meetingId":"B", "label":"B", "text":"Original B"}]},
            {"role":"user", "content":"Question about an uncited excerpt"},
            {"role":"assistant", "content":"Uncited fact from A", "sourceMeetingIds":["A"]}
        ]).to_string();
        save(&pool, FIRST, &messages).await.unwrap();
        save(&pool, SECOND, r#"[{"role":"user","content":"Unrelated chat"}]"#).await.unwrap();
        sqlx::query("DELETE FROM meetings WHERE id = 'A'").execute(&pool).await.unwrap();
        let stored = read(&pool, FIRST).await;
        assert_eq!(stored[1]["content"], "");
        assert!(stored[1]["notice"].as_str().unwrap().contains("deleted"));
        assert!(stored[1].get("sources").is_none());
        assert_eq!(stored[3]["content"], "Copied fact B");
        assert_eq!(stored[5]["content"], "");
        assert_eq!(stored[0]["content"], "Synthetic question");
        save(&pool, FIRST, &messages).await.unwrap();
        assert_eq!(read(&pool, FIRST).await, stored);
        assert_eq!(read(&pool, SECOND).await[0]["content"], "Unrelated chat");
        let references: Vec<String> = sqlx::query_scalar("SELECT meeting_id FROM library_chat_sources WHERE chat_id = ?").bind(FIRST).fetch_all(&pool).await.unwrap();
        assert_eq!(references, vec!["B"]);
    }
    #[tokio::test]
    async fn conversation_and_draft_survive_database_close_and_reopen() {
        let path = std::env::temp_dir().join(format!("afterword-chat-test-{}.db", uuid::Uuid::new_v4()));
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(options.clone()).await.unwrap();
        sqlx::query("CREATE TABLE meetings(id TEXT PRIMARY KEY)").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909020000_library_chats.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909210000_library_recent_scope.sql")).execute(&pool).await.unwrap();
        let messages = r#"[{"role":"user","content":"Synthetic durable question"},{"role":"assistant","content":"Synthetic durable answer"}]"#;
        save(&pool, FIRST, messages).await.unwrap();
        save_settings(&pool, FIRST, "Unsent follow-up", "30", "recent").await.unwrap();
        pool.close().await;
        let reopened = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
        assert_eq!(read(&reopened, FIRST).await, serde_json::from_str::<serde_json::Value>(messages).unwrap());
        let row: (String, String, String) = sqlx::query_as("SELECT draft, period, source_scope FROM library_chats WHERE id = ?").bind(FIRST).fetch_one(&reopened).await.unwrap();
        assert_eq!(row, ("Unsent follow-up".into(), "30".into(), "recent".into()));
        reopened.close().await;
        std::fs::remove_file(path).unwrap();
    }
}
