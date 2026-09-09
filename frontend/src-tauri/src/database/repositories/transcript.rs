use crate::api::{TranscriptSearchResult, TranscriptSegment};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqlitePool};
use tracing::{error, info};
use uuid::Uuid;

pub struct TranscriptsRepository;

impl TranscriptsRepository {
    /// Saves a new meeting and its associated transcript segments.
    /// This function uses a transaction to ensure that either both the meeting
    /// and all its transcripts are saved, or none of them are.
    pub async fn save_transcript(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
        source_recording_id: Option<&str>,
    ) -> Result<String, SqlxError> {
        // A stable source ID makes retries safe after a lost IPC response or failed notes save.
        let meeting_id = source_recording_id
            .map(|id| format!("meeting-recording-{}", id))
            .unwrap_or_else(|| format!("meeting-{}", Uuid::new_v4()));

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now();

        // 1. Create the new meeting
        let result = sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(&meeting_id)
        .bind(meeting_title)
        .bind(now)
        .bind(now)
        .bind(&folder_path)
        .execute(&mut *transaction)
        .await;

        let inserted = result?;
        if inserted.rows_affected() == 0 {
            transaction.commit().await?;
            return Ok(meeting_id);
        }

        info!("Successfully created meeting with id: {}", meeting_id);

        // 2. Save each transcript segment with audio timing fields
        for segment in transcripts {
            let transcript_id = format!("transcript-{}", Uuid::new_v4());
            let result = sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&transcript_id)
            .bind(&meeting_id)
            .bind(&segment.text)
            .bind(&segment.timestamp)
            .bind(segment.audio_start_time)
            .bind(segment.audio_end_time)
            .bind(segment.duration)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!(
                    "Failed to save transcript segment for meeting {}: {}",
                    meeting_id, e
                );
                transaction.rollback().await?;
                return Err(e);
            }
        }

        info!(
            "Successfully saved {} transcript segments for meeting {}",
            transcripts.len(),
            meeting_id
        );

        // Commit the transaction
        transaction.commit().await?;

        Ok(meeting_id)
    }

    /// Searches for a query string within the transcripts.
    /// It returns a list of matching transcripts with context.
    pub async fn search_transcripts(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<TranscriptSearchResult>, SqlxError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        // Search input is literal text, not a LIKE pattern.
        let escaped = query.trim().to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let search_query = format!("%{}%", escaped);

        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT m.id, m.title, t.transcript, t.timestamp
             FROM meetings m
             JOIN transcripts t ON t.id = (
                 SELECT id FROM transcripts
                 WHERE meeting_id = m.id AND LOWER(transcript) LIKE ? ESCAPE '\\'
                 ORDER BY audio_start_time ASC, id ASC LIMIT 1
             )
             ORDER BY m.created_at DESC, m.id ASC LIMIT 100",
        )
        .bind(&search_query)
        .fetch_all(pool)
        .await?;

        let results = rows
            .into_iter()
            .map(|(id, title, transcript, timestamp)| {
                let match_context = Self::get_match_context(&transcript, query.trim());
                TranscriptSearchResult {
                    id,
                    title,
                    match_context,
                    timestamp,
                }
            })
            .collect();

        Ok(results)
    }

    /// Helper function to extract a snippet of text around the first match of a query.
    fn get_match_context(transcript: &str, query: &str) -> String {
        let transcript_lower = transcript.to_lowercase();
        let query_lower = query.to_lowercase();

        let chars: Vec<char> = transcript.chars().collect();
        let (start, end) = if let Some(byte_start) = transcript_lower.find(&query_lower) {
            // Map lowercased byte offsets back to original characters. Lowercasing
            // can expand characters (for example İ), so original byte offsets differ.
            let byte_end = byte_start + query_lower.len();
            let mut lowered_offset = 0;
            let mut first = None;
            let mut last = 0;
            for (index, ch) in chars.iter().enumerate() {
                let next = lowered_offset + ch.to_lowercase().map(char::len_utf8).sum::<usize>();
                if lowered_offset < byte_end && next > byte_start {
                    first.get_or_insert(index);
                    last = index + 1;
                }
                lowered_offset = next;
                if lowered_offset >= byte_end { break; }
            }
            (first.unwrap_or(0).saturating_sub(100), (last + 100).min(chars.len()))
        } else {
            (0, chars.len().min(200))
        };
        format!("{}{}{}", if start > 0 { "..." } else { "" },
            chars[start..end].iter().collect::<String>(),
            if end < chars.len() { "..." } else { "" })
    }
}

#[cfg(test)]
mod quality_tests {
    use super::*;

    async fn database() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn segment() -> TranscriptSegment {
        TranscriptSegment {
            id: "synthetic".into(), text: "Synthetic transcript".into(), timestamp: "00:01".into(),
            audio_start_time: Some(1.0), audio_end_time: Some(2.0), duration: Some(1.0),
        }
    }


    #[test]
    fn search_snippets_preserve_unicode_boundaries_and_lowercase_expansions() {
        for text in [format!("ab{}", "é".repeat(180)), format!("{}target{}", "🙂項目".repeat(120), "界".repeat(150)),
            format!("{}TARGET end", "İ".repeat(120))] {
            let query = if text.starts_with("ab") { "a" } else { "target" };
            let snippet = TranscriptsRepository::get_match_context(&text, query);
            assert!(snippet.to_lowercase().contains(query), "{snippet}");
            assert!(snippet.chars().count() <= 212);
        }
        assert_eq!(TranscriptsRepository::get_match_context("İstanbul", "i"), "İstanbul");
        assert_eq!(TranscriptsRepository::get_match_context("Small note", "missing"), "Small note");
    }

    #[tokio::test]
    async fn search_is_literal_deduplicated_and_bounded() {
        let pool = database().await;
        for i in 0..105 {
            let mut first = segment(); first.text = "Match 100%_done".into();
            let mut second = segment(); second.id = "second".into(); second.text = "Match again".into();
            TranscriptsRepository::save_transcript(&pool, "Synthetic", &[first, second], None, Some(&format!("search-{i}"))).await.unwrap();
        }
        let matches = TranscriptsRepository::search_transcripts(&pool, "match").await.unwrap();
        assert_eq!(matches.len(), 100);
        assert_eq!(matches.iter().map(|row| &row.id).collect::<std::collections::HashSet<_>>().len(), 100);
        assert_eq!(TranscriptsRepository::search_transcripts(&pool, "%_done").await.unwrap().len(), 100);
        assert!(TranscriptsRepository::search_transcripts(&pool, "_missing%").await.unwrap().is_empty());
        assert!(TranscriptsRepository::search_transcripts(&pool, " ").await.unwrap().is_empty());
        let plan: Vec<(i64, i64, i64, String)> = sqlx::query_as(
            "EXPLAIN QUERY PLAN SELECT id FROM transcripts WHERE meeting_id = ? AND LOWER(transcript) LIKE ? ORDER BY audio_start_time, id LIMIT 1"
        ).bind("synthetic").bind("%match%").fetch_all(&pool).await.unwrap();
        assert!(plan.iter().any(|row| row.3.contains("idx_transcripts_meeting_order")));
    }

    #[tokio::test]
    async fn quality_save_retry_reuses_meeting_without_duplicate_transcripts() {
        let pool = database().await;
        let first = TranscriptsRepository::save_transcript(&pool, "Synthetic", &[segment()], None, Some("meeting-123")).await.unwrap();
        // Simulate a retry after notes failed or the successful IPC reply was lost.
        let retry = TranscriptsRepository::save_transcript(&pool, "Synthetic", &[segment()], None, Some("meeting-123")).await.unwrap();
        assert_eq!(first, retry);
        let counts: (i64, i64) = sqlx::query_as("SELECT (SELECT COUNT(*) FROM meetings), (SELECT COUNT(*) FROM transcripts)")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(counts, (1, 1));
        let other = TranscriptsRepository::save_transcript(&pool, "Other", &[], None, Some("meeting-124")).await.unwrap();
        assert_ne!(first, other);
    }

    #[tokio::test]
    async fn quality_failed_transcript_write_rolls_back_and_can_retry() {
        let pool = database().await;
        sqlx::raw_sql("CREATE TRIGGER reject_transcript BEFORE INSERT ON transcripts BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END;")
            .execute(&pool).await.unwrap();
        assert!(TranscriptsRepository::save_transcript(&pool, "Synthetic", &[segment()], None, Some("meeting-123")).await.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meetings").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0);
        sqlx::raw_sql("DROP TRIGGER reject_transcript").execute(&pool).await.unwrap();
        assert!(TranscriptsRepository::save_transcript(&pool, "Synthetic", &[segment()], None, Some("meeting-123")).await.is_ok());
    }
}
