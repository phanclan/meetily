use crate::state::AppState;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LibraryExcerpt {
    meeting_id: String,
    title: String,
    created_at: String,
    kind: String,
    audio_start_time: Option<f64>,
    text: String,
}

// The UI sends words, never an executable FTS expression. Bound both work and output.
fn expression(terms: &[String]) -> Result<String, String> {
    if terms.is_empty() || terms.len() > 24 {
        return Err("Include a topic, name, or phrase to search for.".into());
    }
    let mut quoted = Vec::new();
    for term in terms {
        if term.chars().count() > 80 || !term.chars().any(char::is_alphanumeric) {
            return Err("Search words must contain letters or numbers and be under 80 characters.".into());
        }
        quoted.push(format!("\"{}\"", term.replace('"', "\"\"")));
    }
    Ok(quoted.join(" OR "))
}

async fn search(pool: &SqlitePool, terms: &[String], since_days: Option<u32>) -> Result<Vec<LibraryExcerpt>, String> {
    let query = expression(terms)?;
    if !matches!(since_days, None | Some(7 | 30 | 90)) {
        return Err("Choose All time, Last 7 days, Last 30 days, or Last 90 days.".into());
    }
    let since = since_days.map(|days| (chrono::Utc::now() - chrono::Duration::days(days.into())).to_rfc3339());
    let candidates = sqlx::query_as::<_, LibraryExcerpt>(
        "WITH scores AS MATERIALIZED (
             SELECT d.id, d.meeting_id, m.created_at, bm25(library_search, 2.0, 1.0) AS score
             FROM library_search JOIN library_documents d ON d.id = library_search.rowid
             JOIN meetings m ON m.id = d.meeting_id
             WHERE library_search MATCH ? AND length(trim(d.body)) > 0
               AND (? IS NULL OR julianday(m.created_at) >= julianday(?))
         ), diversified AS (
             SELECT *, row_number() OVER (PARTITION BY meeting_id ORDER BY score, id) AS position FROM scores
         ), chosen AS (
             SELECT id FROM diversified WHERE position <= 4 ORDER BY score, created_at DESC, id LIMIT 16
         )
         SELECT d.meeting_id, m.title, m.created_at, d.kind, d.audio_start_time,
                snippet(library_search, 1, '', '', '…', 64) AS text
         FROM library_search JOIN library_documents d ON d.id = library_search.rowid
         JOIN meetings m ON m.id = d.meeting_id
         WHERE library_search MATCH ? AND d.id IN (SELECT id FROM chosen)
         ORDER BY bm25(library_search, 2.0, 1.0), m.created_at DESC, d.id")
        .bind(&query).bind(&since).bind(&since).bind(&query).fetch_all(pool).await
        .map_err(|error| format!("Could not search saved notes: {error}"))?;
    let mut counts = HashMap::new();
    let mut excerpts = Vec::new();
    for mut item in candidates {
        // A prolific meeting must not occupy the entire model context.
        let count = counts.entry(item.meeting_id.clone()).or_insert(0);
        if *count >= 4 { continue; }
        *count += 1;
        // FTS token limits alone do not bound unusually long words or pasted URLs.
        if item.text.chars().count() > 1800 {
            item.text = item.text.chars().take(1800).collect::<String>() + "…";
        }
        excerpts.push(item);
        if excerpts.len() == 16 { break; }
    }
    Ok(excerpts)
}

#[tauri::command]
pub async fn search_library_sources(state: tauri::State<'_, AppState>, terms: Vec<String>, since_days: Option<u32>) -> Result<Vec<LibraryExcerpt>, String> {
    search(state.db_manager.pool(), &terms, since_days).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20250916100000_initial_schema.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql("ALTER TABLE transcripts ADD COLUMN audio_start_time REAL;").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20251223000000_add_meeting_notes.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql("INSERT INTO meetings VALUES ('A', 'Alpha', '2020-01-01', '2020-01-01'), ('B', 'Beta', '2099-01-01', '2099-01-01');
            INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time) VALUES ('a', 'A', 'Mira owns the comet launch. The date is not confirmed.', '0:45', 45);
            INSERT INTO meeting_notes VALUES ('B', 'Comet budget is proposed, not approved.', NULL, '', '');").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909010000_library_search.sql")).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn indexes_existing_notes_and_transcripts_and_filters_dates() {
        let pool = fixture().await;
        let hits = search(&pool, &["comet".into()], None).await.unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().any(|s| s.meeting_id == "A" && s.audio_start_time == Some(45.0) && s.text.contains("not confirmed")));
        let hits = search(&pool, &["comet".into()], Some(7)).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].meeting_id, "B");
        assert!(search(&pool, &["comet".into()], Some(2)).await.is_err());
        assert!(search(&pool, &["missingterm".into()], None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn edits_moves_renames_and_deletes_update_search_atomically() {
        let pool = fixture().await;
        sqlx::raw_sql("UPDATE transcripts SET transcript = 'Changed to a lunar launch.' WHERE id = 'a';
            UPDATE meeting_notes SET meeting_id = 'A', notes_markdown = 'Café launch approved.' WHERE meeting_id = 'B';
            UPDATE meetings SET title = 'Renamed' WHERE id = 'A';
            INSERT INTO transcripts (id, meeting_id, transcript, timestamp) VALUES ('b', 'B', 'Newly inserted aurora transcript.', '');").execute(&pool).await.unwrap();
        assert!(search(&pool, &["comet".into()], None).await.unwrap().is_empty());
        let hits = search(&pool, &["cafe".into()], None).await.unwrap();
        assert_eq!(hits[0].meeting_id, "A");
        assert_eq!(hits[0].title, "Renamed");
        assert_eq!(search(&pool, &["renamed".into()], None).await.unwrap().len(), 2);
        assert_eq!(search(&pool, &["aurora".into()], None).await.unwrap().len(), 1);
        sqlx::query("DELETE FROM meetings WHERE id = 'A'").execute(&pool).await.unwrap();
        assert!(search(&pool, &["cafe".into(), "lunar".into()], None).await.unwrap().is_empty());
        sqlx::query("DELETE FROM transcripts WHERE id = 'b'").execute(&pool).await.unwrap();
        assert!(search(&pool, &["aurora".into()], None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn bounds_sources_and_treats_fts_operators_as_text() {
        let pool = fixture().await;
        for i in 0..200 {
            sqlx::query("INSERT INTO transcripts(id, meeting_id, transcript, timestamp) VALUES (?, 'A', 'Comet progress', '')").bind(format!("many-{i}")).execute(&pool).await.unwrap();
        }
        let hits = search(&pool, &["comet".into()], None).await.unwrap();
        assert!(hits.iter().filter(|s| s.meeting_id == "A").count() <= 4);
        assert!(hits.iter().any(|s| s.meeting_id == "B"));
        assert!(search(&pool, &["comet\" OR body:missing".into()], None).await.unwrap().is_empty());
        assert!(expression(&[]).is_err());
        assert!(expression(&["x".repeat(81)]).is_err());
    }

    #[tokio::test]
    #[ignore = "Calls local Ollama with synthetic indexed meetings; run explicitly"]
    async fn local_model_answers_from_two_indexed_meetings() {
        use crate::summary::llm_client::{query_with_context, LLMProvider};
        let pool = fixture().await;
        let excerpts = search(&pool, &["comet".into()], None).await.unwrap();
        let context = format!("Partial keyword-matched excerpts from separate meetings. These are not an exhaustive search.\n\n{}",
            excerpts.iter().enumerate().map(|(i, item)| format!("[S{}] {} · {} · {}\n{}", i + 1, item.title, item.created_at, item.kind, item.text)).collect::<Vec<_>>().join("\n\n"));
        let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().unwrap();
        let answer = query_with_context(&client, &LLMProvider::Ollama, "gemma4:e4b-mlx", "", &context,
            "Who owns the Comet launch, and was its budget approved?", &[], Some("http://localhost:11434"), None, None, None, None).await.unwrap();
        println!("Synthetic cross-meeting answer: {answer}");
        assert!(answer.contains("Mira"));
        let lower = answer.to_lowercase();
        assert!(lower.contains("not approved") || lower.contains("pending") || lower.contains("proposed"));
        assert!(answer.contains("#source-S1") && answer.contains("#source-S2"));
    }
}
