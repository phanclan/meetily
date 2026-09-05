use crate::database::models::MeetingNotes;
use chrono::Utc;
use sqlx::SqlitePool;

pub struct NotesRepository;

impl NotesRepository {
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
            "SELECT * FROM meeting_notes WHERE meeting_id = $1",
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
