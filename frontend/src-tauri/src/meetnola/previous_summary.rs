use crate::state::AppState;
use serde::Serialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousSummary {
    version_id: String,
    saved_at: String,
    current_revision: String,
    result: Value,
}

async fn read_previous(pool: &SqlitePool, meeting_id: &str) -> Result<Option<PreviousSummary>, String> {
    let row = sqlx::query("SELECT h.version_id, h.saved_at, h.result, p.updated_at, p.status FROM previous_summaries h JOIN summary_processes p ON p.meeting_id = h.meeting_id WHERE h.meeting_id = ?")
        .bind(meeting_id).fetch_optional(pool).await.map_err(|e| e.to_string())?;
    row.map(|row| {
        let status: String = row.get("status");
        if matches!(status.to_lowercase().as_str(), "pending" | "processing") {
            return Err("Wait for enhancement to finish before restoring a version.".into());
        }
        let raw: String = row.get("result");
        Ok(PreviousSummary {
            version_id: row.get("version_id"), saved_at: row.get("saved_at"),
            current_revision: row.get("updated_at"),
            result: serde_json::from_str(&raw).map_err(|_| "The previous enhancement could not be read.")?,
        })
    }).transpose()
}

async fn restore_previous(pool: &SqlitePool, meeting_id: &str, revision: &str, version_id: &str) -> Result<Value, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // A lost IPC response may be retried with the same version. Never swap twice.
    let replay: Option<String> = sqlx::query_scalar("SELECT p.result FROM previous_summaries h JOIN summary_processes p ON p.meeting_id = h.meeting_id WHERE h.meeting_id = ? AND h.last_restore_source_version = ? AND h.last_restore_revision = p.updated_at AND lower(p.status) NOT IN ('pending', 'processing')")
        .bind(meeting_id).bind(version_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    if let Some(replay) = replay {
        let result = serde_json::from_str(&replay).map_err(|_| "The restored enhancement could not be read.")?;
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(result);
    }
    let row = sqlx::query("SELECT p.result AS current_result, h.result AS previous_result FROM summary_processes p JOIN previous_summaries h ON h.meeting_id = p.meeting_id WHERE p.meeting_id = ? AND p.updated_at = ? AND h.version_id = ? AND lower(p.status) NOT IN ('pending', 'processing')")
        .bind(meeting_id).bind(revision).bind(version_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?
        .ok_or("This note changed. Close and reopen Previous enhancement before restoring.")?;
    let previous: String = row.get("previous_result");
    let current: String = row.try_get("current_result").map_err(|_| "There is no current enhancement to replace.")?;
    let result: Value = serde_json::from_str(&previous).map_err(|_| "The previous enhancement could not be read.")?;
    let now = chrono::Utc::now().to_rfc3339();
    let changed = sqlx::query("UPDATE summary_processes SET result = ?, status = 'completed', error = NULL, updated_at = ?, result_backup = NULL, result_backup_timestamp = NULL WHERE meeting_id = ? AND updated_at = ? AND lower(status) NOT IN ('pending', 'processing')")
        .bind(&previous).bind(&now).bind(meeting_id).bind(revision).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    if changed.rows_affected() != 1 { return Err("This note changed. Reopen the preview before restoring.".into()); }
    // Swap instead of discarding the current version, allowing this restore to be undone.
    sqlx::query("UPDATE previous_summaries SET result = ?, version_id = ?, saved_at = ?, last_restore_source_version = ?, last_restore_revision = ? WHERE meeting_id = ? AND version_id = ?")
        .bind(current).bind(uuid::Uuid::new_v4().to_string()).bind(&now).bind(version_id).bind(&now).bind(meeting_id).bind(version_id)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?").bind(&now).bind(meeting_id)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn get_previous_summary(state: tauri::State<'_, AppState>, meeting_id: String) -> Result<Option<PreviousSummary>, String> {
    read_previous(state.db_manager.pool(), &meeting_id).await
}

#[tauri::command]
pub async fn restore_previous_summary(state: tauri::State<'_, AppState>, meeting_id: String, current_revision: String, version_id: String) -> Result<Value, String> {
    restore_previous(state.db_manager.pool(), &meeting_id, &current_revision, &version_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::repositories::summary::SummaryProcessesRepository as Summaries;

    async fn fixture() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings (id,title,created_at,updated_at) VALUES ('A','Custom title','',''), ('B','Other note','','')").execute(&pool).await.unwrap();
        pool
    }
    async fn enhance(pool: &SqlitePool, content: &str) {
        Summaries::create_or_reset_process(pool, "A").await.unwrap();
        Summaries::update_process_completed(pool, "A", serde_json::json!({"markdown": content}), 1, 1.0).await.unwrap();
    }

    #[tokio::test]
    async fn previous_summary_preserves_edits_swaps_and_rejects_stale_or_cross_note_restore() {
        let pool = fixture().await;
        enhance(&pool, "First").await;
        assert!(read_previous(&pool, "A").await.unwrap().is_none());
        let edited = serde_json::json!({"markdown":"Edited first", "summary_json":[{"type":"paragraph"}]});
        Summaries::update_meeting_summary(&pool, "A", &edited).await.unwrap();
        enhance(&pool, "Second").await;
        let old = read_previous(&pool, "A").await.unwrap().unwrap();
        assert_eq!(old.result, edited);
        assert!(restore_previous(&pool, "B", &old.current_revision, &old.version_id).await.is_err());
        assert_eq!(restore_previous(&pool, "A", &old.current_revision, &old.version_id).await.unwrap(), edited);
        assert_eq!(restore_previous(&pool, "A", &old.current_revision, &old.version_id).await.unwrap(), edited);
        let undo = read_previous(&pool, "A").await.unwrap().unwrap();
        assert_eq!(undo.result["markdown"], "Second");
        restore_previous(&pool, "A", &undo.current_revision, &undo.version_id).await.unwrap();
        let stale = read_previous(&pool, "A").await.unwrap().unwrap();
        Summaries::update_meeting_summary(&pool, "A", &serde_json::json!({"markdown":"Latest edit"})).await.unwrap();
        assert!(restore_previous(&pool, "A", &stale.current_revision, &stale.version_id).await.is_err());
        let current = Summaries::get_summary_data(&pool, "A").await.unwrap().unwrap();
        assert!(current.result.unwrap().contains("Latest edit"));
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT title FROM meetings WHERE id='A'").fetch_one(&pool).await.unwrap(), "Custom title");
    }

    #[tokio::test]
    async fn previous_summary_survives_failed_and_cancelled_jobs_and_is_removed_with_the_note() {
        let pool = fixture().await;
        enhance(&pool, "First").await; enhance(&pool, "Second").await;
        let previous = read_previous(&pool, "A").await.unwrap().unwrap();
        for cancelled in [false, true] {
            Summaries::create_or_reset_process(&pool, "A").await.unwrap();
            assert!(read_previous(&pool, "A").await.is_err());
            assert!(restore_previous(&pool, "A", &previous.current_revision, &previous.version_id).await.is_err());
            if cancelled { Summaries::update_process_cancelled(&pool, "A").await.unwrap(); }
            else { Summaries::update_process_failed(&pool, "A", "Synthetic failure").await.unwrap(); }
            let kept = read_previous(&pool, "A").await.unwrap().unwrap();
            assert_eq!(kept.version_id, previous.version_id);
            assert_eq!(kept.result["markdown"], "First");
        }
        enhance(&pool, "Third").await;
        assert_eq!(read_previous(&pool, "A").await.unwrap().unwrap().result["markdown"], "Second");
        sqlx::query("DELETE FROM meetings WHERE id='A'").execute(&pool).await.unwrap();
        assert!(read_previous(&pool, "A").await.unwrap().is_none());
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM previous_summaries").fetch_one(&pool).await.unwrap(), 0);
    }
}
