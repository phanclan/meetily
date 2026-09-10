use crate::database::models::MeetingNotes;
use chrono::Utc;
use sqlx::SqlitePool;

pub struct NotesRepository;

impl NotesRepository {
    /// Create a standalone note and its optional folder membership atomically.
    /// A retry returns the original note without overwriting later library edits.
    pub async fn create_note(
        pool: &SqlitePool,
        draft_id: &str,
        title: &str,
        markdown: &str,
        json: &str,
        folder_id: Option<&str>,
    ) -> Result<String, String> {
        let draft_id = uuid::Uuid::parse_str(draft_id).map_err(|_| "Invalid draft save ID")?;
        if markdown.trim().is_empty() { return Err("Write something before saving the note.".into()); }
        let blocks: serde_json::Value = serde_json::from_str(json).map_err(|_| "Invalid note content")?;
        if !blocks.is_array() { return Err("Invalid note content".into()); }
        let meeting_id = format!("meeting-note-{draft_id}");
        let now = Utc::now().to_rfc3339();
        let write_error = |error: sqlx::Error| format!("Could not save the note: {error}");
        let mut tx = pool.begin().await.map_err(write_error)?;
        let inserted = sqlx::query("INSERT INTO meetings(id, title, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
            .bind(&meeting_id).bind(title).bind(&now).bind(&now)
            .execute(&mut *tx).await.map_err(write_error)?;
        if inserted.rows_affected() > 0 {
            sqlx::query("INSERT INTO meeting_notes(meeting_id, notes_markdown, notes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
                .bind(&meeting_id).bind(markdown).bind(json).bind(&now).bind(&now)
                .execute(&mut *tx).await.map_err(write_error)?;
            if let Some(folder_id) = folder_id {
                sqlx::query("INSERT INTO note_folder_members(folder_id, meeting_id) VALUES (?, ?)")
                    .bind(folder_id).bind(&meeting_id).execute(&mut *tx).await.map_err(write_error)?;
            }
        }
        tx.commit().await.map_err(write_error)?;
        Ok(meeting_id)
    }

    pub async fn save_notes(
        pool: &SqlitePool,
        meeting_id: &str,
        notes_markdown: Option<&str>,
        notes_json: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO meeting_notes (meeting_id, notes_markdown, notes_json, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $4)
            ON CONFLICT(meeting_id) DO UPDATE SET
                notes_markdown = excluded.notes_markdown,
                notes_json = excluded.notes_json,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(meeting_id)
        .bind(notes_markdown)
        .bind(notes_json)
        .bind(&now)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn get_notes(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingNotes>, sqlx::Error> {
        let notes = sqlx::query_as::<_, MeetingNotes>(
            "SELECT * FROM meeting_notes WHERE meeting_id = $1 AND NOT EXISTS(SELECT 1 FROM meeting_trash WHERE meeting_id = $1)",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;
        Ok(notes)
    }

    pub async fn move_notes(
        pool: &SqlitePool,
        from_meeting_id: &str,
        to_meeting_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE meeting_notes SET meeting_id = $1, updated_at = $2 WHERE meeting_id = $3",
        )
        .bind(to_meeting_id)
        .bind(Utc::now().to_rfc3339())
        .bind(from_meeting_id)
        .execute(pool)
        .await?;

        Ok(())
    }
}

#[cfg(test)]
mod standalone_tests {
    use super::*;
    const DRAFT: &str = "a3d3777b-2ef4-4d65-b56f-ff2e4db58b75";
    async fn database() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn creates_searchable_notes_with_folder_and_no_transcripts() {
        let pool = database().await;
        sqlx::query("INSERT INTO note_folders VALUES ('folder-a','Review','review','2026-09-09')").execute(&pool).await.unwrap();
        let id = NotesRepository::create_note(&pool, DRAFT, "Synthetic", "Zirconium review", "[]", Some("folder-a")).await.unwrap();
        assert_eq!(NotesRepository::get_notes(&pool, &id).await.unwrap().unwrap().notes_markdown.as_deref(), Some("Zirconium review"));
        let membership: i64 = sqlx::query_scalar("SELECT count(*) FROM note_folder_members WHERE meeting_id=? AND folder_id='folder-a'").bind(&id).fetch_one(&pool).await.unwrap();
        assert_eq!(membership, 1);
        let transcripts: i64 = sqlx::query_scalar("SELECT count(*) FROM transcripts").fetch_one(&pool).await.unwrap();
        assert_eq!(transcripts, 0);
        let hits: i64 = sqlx::query_scalar("SELECT count(*) FROM library_search WHERE library_search MATCH 'Zirconium'").fetch_one(&pool).await.unwrap();
        assert_eq!(hits, 1);
    }

    #[tokio::test]
    async fn retry_does_not_duplicate_or_overwrite_a_later_edit() {
        let pool = database().await;
        let id = NotesRepository::create_note(&pool, DRAFT, "Synthetic", "Original", "[]", None).await.unwrap();
        NotesRepository::save_notes(&pool, &id, Some("Edited in library"), Some("[]")).await.unwrap();
        assert_eq!(NotesRepository::create_note(&pool, DRAFT, "Synthetic", "Original", "[]", None).await.unwrap(), id);
        assert_eq!(NotesRepository::get_notes(&pool, &id).await.unwrap().unwrap().notes_markdown.as_deref(), Some("Edited in library"));
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM meetings").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn failed_membership_rolls_back_the_whole_note_and_invalid_input_writes_nothing() {
        let pool = database().await;
        assert!(NotesRepository::create_note(&pool, DRAFT, "Synthetic", "Zirconium", "[]", Some("missing")).await.is_err());
        assert!(NotesRepository::create_note(&pool, "bad-id", "Synthetic", "Text", "[]", None).await.is_err());
        assert!(NotesRepository::create_note(&pool, DRAFT, "Synthetic", " ", "[]", None).await.is_err());
        assert!(NotesRepository::create_note(&pool, DRAFT, "Synthetic", "Text", "{}", None).await.is_err());
        let counts: (i64, i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM meetings), (SELECT count(*) FROM meeting_notes), (SELECT count(*) FROM library_search)").fetch_one(&pool).await.unwrap();
        assert_eq!(counts, (0, 0, 0));
        assert!(NotesRepository::create_note(&pool, DRAFT, "Synthetic", "Text", "[]", None).await.is_ok());
    }
}
