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
    source_id: Option<String>,
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
             JOIN meetings m ON m.id = d.meeting_id AND NOT EXISTS(SELECT 1 FROM meeting_trash WHERE meeting_id = m.id)
             WHERE library_search MATCH ? AND length(trim(d.body)) > 0
               AND (? IS NULL OR julianday(m.created_at) >= julianday(?))
         ), diversified AS (
             SELECT *, row_number() OVER (PARTITION BY meeting_id ORDER BY score, id) AS position FROM scores
         ), chosen AS (
             SELECT id FROM diversified WHERE position <= 4 ORDER BY score, created_at DESC, id LIMIT 16
         )
         SELECT d.meeting_id, m.title, m.created_at, d.kind, d.source_id, d.audio_start_time,
                snippet(library_search, 1, '', '', '…', 64) AS text
         FROM library_search JOIN library_documents d ON d.id = library_search.rowid
         JOIN meetings m ON m.id = d.meeting_id AND NOT EXISTS(SELECT 1 FROM meeting_trash WHERE meeting_id = m.id)
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentSources { excerpts: Vec<LibraryExcerpt>, total_meetings: i64 }

async fn recent_sources(pool: &SqlitePool, since_days: Option<u32>) -> Result<RecentSources, String> {
    if !matches!(since_days, None | Some(7 | 30 | 90)) {
        return Err("Choose All time, Last 7 days, Last 30 days, or Last 90 days.".into());
    }
    let since = since_days.map(|days| (chrono::Utc::now() - chrono::Duration::days(days.into())).to_rfc3339());
    // Count, selection, size check and full bodies share one snapshot. Never fall back
    // to beginning excerpts: the commitment may be the final transcript segment.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let meetings: Vec<(String, i64)> = sqlx::query_as(
        "SELECT m.id, count(*) OVER () FROM meetings m
         WHERE NOT EXISTS(SELECT 1 FROM meeting_trash WHERE meeting_id = m.id)
           AND EXISTS(SELECT 1 FROM library_documents d WHERE d.meeting_id = m.id AND length(trim(d.body)) > 0)
           AND (? IS NULL OR julianday(m.created_at) >= julianday(?))
         ORDER BY julianday(m.created_at) DESC, m.id LIMIT 5")
        .bind(&since).bind(&since).fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
    let total_meetings = meetings.first().map(|m| m.1).unwrap_or(0);
    let ids = serde_json::to_string(&meetings.iter().map(|m| &m.0).collect::<Vec<_>>()).map_err(|e| e.to_string())?;
    let (bytes, rows): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(sum(length(CAST(d.body AS BLOB)) + length(CAST(m.title AS BLOB)) + 256), 0), count(*)
         FROM library_documents d JOIN meetings m ON m.id = d.meeting_id
         WHERE d.meeting_id IN (SELECT value FROM json_each(?)) AND length(trim(d.body)) > 0")
        .bind(&ids).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
    if bytes > 120000 || rows > 1000 {
        return Err("These recent meetings are too large to review together. Choose a shorter date range, use Keyword matches, or open a meeting to ask about its full notes. No source text was cut off.".into());
    }
    let excerpts = sqlx::query_as::<_, LibraryExcerpt>(
        "SELECT d.meeting_id, m.title, m.created_at, d.kind, d.source_id, d.audio_start_time, d.body AS text
         FROM library_documents d JOIN meetings m ON m.id = d.meeting_id
         WHERE d.meeting_id IN (SELECT value FROM json_each(?)) AND length(trim(d.body)) > 0
         ORDER BY julianday(m.created_at) DESC, m.id, d.kind, COALESCE(d.audio_start_time, 0), d.id")
        .bind(&ids).fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(RecentSources { excerpts, total_meetings })
}

#[tauri::command]
pub async fn get_recent_library_sources(state: tauri::State<'_, AppState>, since_days: Option<u32>) -> Result<RecentSources, String> {
    recent_sources(state.db_manager.pool(), since_days).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSearchPage { meetings: Vec<LibraryExcerpt>, has_more: bool }

fn discovery_expression(query: &str) -> Result<String, String> {
    if query.chars().count() > 200 { return Err("Keep the search under 200 characters.".into()); }
    let terms: Vec<String> = query.split_whitespace()
        .filter(|term| term.chars().any(char::is_alphanumeric))
        .map(str::to_owned).collect();
    // Standalone symbols are separators, not invalid words. An empty quoted FTS
    // phrase matches no body tokens while literal title matching still works.
    if terms.is_empty() { Ok("\"\"".to_owned()) } else { expression(&terms) }
}

// Discovery has one result per meeting and paging, independent of chat's excerpt budget.
async fn search_meetings(pool: &SqlitePool, query: &str, offset: u32, folder_id: Option<&str>) -> Result<MeetingSearchPage, String> {
    let query = query.trim();
    if query.is_empty() { return Ok(MeetingSearchPage { meetings: vec![], has_more: false }); }
    let fts = discovery_expression(query)?;
    let title_pattern = format!("%{}%", query.replace('!', "!!").replace('%', "!%").replace('_', "!_"));
    let mut meetings: Vec<LibraryExcerpt> = sqlx::query_as(
        "WITH scores AS MATERIALIZED (
            SELECT d.id AS document_id, d.meeting_id, bm25(library_search, 2.0, 1.0) AS score
            FROM library_search JOIN library_documents d ON d.id = library_search.rowid
            WHERE library_search MATCH ?
            UNION ALL
            SELECT NULL, id, -1000000.0 FROM meetings WHERE title LIKE ? ESCAPE '!'
        ), ranked AS (
            SELECT *, row_number() OVER (PARTITION BY meeting_id ORDER BY score, document_id) AS position FROM scores
        ), chosen AS (
            SELECT r.* FROM ranked r JOIN meetings m ON m.id = r.meeting_id WHERE position = 1 AND NOT EXISTS(SELECT 1 FROM meeting_trash WHERE meeting_id = m.id)
            AND (? IS NULL OR EXISTS(SELECT 1 FROM note_folder_members fm WHERE fm.folder_id = ? AND fm.meeting_id = r.meeting_id))
            ORDER BY score, julianday(m.created_at) DESC, m.id LIMIT 31 OFFSET ?
        )
        SELECT m.id AS meeting_id, m.title, m.created_at,
            COALESCE(d.kind, 'title') AS kind, d.source_id, d.audio_start_time,
            CASE WHEN c.document_id IS NULL THEN '' ELSE (
                SELECT snippet(library_search, 1, '', '', '…', 48) FROM library_search
                WHERE rowid = c.document_id AND library_search MATCH ?
            ) END AS text
        FROM chosen c JOIN meetings m ON m.id = c.meeting_id
        LEFT JOIN library_documents d ON d.id = c.document_id
        ORDER BY c.score, julianday(m.created_at) DESC, m.id")
        .bind(fts.clone()).bind(title_pattern).bind(folder_id).bind(folder_id).bind(offset).bind(fts).fetch_all(pool).await
        .map_err(|error| format!("Could not search saved meetings: {error}"))?;
    let has_more = meetings.len() > 30;
    meetings.truncate(30);
    for meeting in &mut meetings {
        if meeting.text.chars().count() > 1800 { meeting.text = meeting.text.chars().take(1800).collect::<String>() + "…"; }
    }
    Ok(MeetingSearchPage { meetings, has_more })
}

#[tauri::command]
pub async fn search_saved_meetings(state: tauri::State<'_, AppState>, query: String, offset: u32, folder_id: Option<String>) -> Result<MeetingSearchPage, String> {
    search_meetings(state.db_manager.pool(), &query, offset, folder_id.as_deref()).await
}

async fn search_match(pool: &SqlitePool, meeting_id: &str, source_id: &str, kind: &str, query: &str) -> Result<Option<LibraryExcerpt>, String> {
    if !matches!(kind, "notes" | "transcript") { return Err("Choose written notes or a transcript source.".into()); }
    let fts = discovery_expression(query.trim())?;
    let mut result = sqlx::query_as::<_, LibraryExcerpt>(
        "SELECT d.meeting_id, m.title, m.created_at, d.kind, d.source_id, d.audio_start_time,
            snippet(library_search, 1, '', '', '…', 96) AS text
         FROM library_search JOIN library_documents d ON d.id = library_search.rowid
         JOIN meetings m ON m.id = d.meeting_id AND NOT EXISTS(SELECT 1 FROM meeting_trash WHERE meeting_id = m.id)
         WHERE d.meeting_id = ? AND d.source_id = ? AND d.kind = ? AND library_search MATCH ?")
        .bind(meeting_id).bind(source_id).bind(kind).bind(fts).fetch_optional(pool).await
        .map_err(|error| format!("Could not load the matching source: {error}"))?;
    if let Some(item) = &mut result {
        if item.text.chars().count() > 1800 { item.text = item.text.chars().take(1800).collect::<String>() + "…"; }
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_saved_search_match(state: tauri::State<'_, AppState>, meeting_id: String, source_id: String, kind: String, query: String) -> Result<Option<LibraryExcerpt>, String> {
    search_match(state.db_manager.pool(), &meeting_id, &source_id, &kind, &query).await
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
        sqlx::raw_sql(include_str!("../../migrations/20260909120000_note_folders.sql")).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/20260909190000_meeting_trash.sql")).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn recent_sources_keep_final_segments_without_keyword_matches_and_bound_meetings() {
        let pool = fixture().await;
        for n in 0..205 {
            sqlx::query("INSERT INTO transcripts(id, meeting_id, transcript, timestamp, audio_start_time) VALUES (?, 'B', ?, '', ?)")
                .bind(format!("segment-{n}"))
                .bind(if n == 204 { "Morgan will send results Friday." } else { "Discussion without task keywords." })
                .bind(n as f64).execute(&pool).await.unwrap();
        }
        let result = recent_sources(&pool, Some(7)).await.unwrap();
        assert_eq!(result.total_meetings, 1);
        assert_eq!(result.excerpts.len(), 206);
        assert_eq!(result.excerpts.last().unwrap().text, "Morgan will send results Friday.");
        assert!(result.excerpts.iter().all(|item| item.meeting_id == "B"));
        for n in 0..6 {
            let id = format!("new-{n}");
            sqlx::query("INSERT INTO meetings VALUES (?, ?, '2100-01-01', '')").bind(&id).bind(&id).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO meeting_notes VALUES (?, 'Synthetic original', NULL, '', '')").bind(&id).execute(&pool).await.unwrap();
        }
        crate::meetnola::trash::trash(&pool, "new-0").await.unwrap();
        let result = recent_sources(&pool, None).await.unwrap();
        assert_eq!(result.total_meetings, 7);
        assert_eq!(result.excerpts.len(), 5);
        assert_eq!(result.excerpts[0].meeting_id, "new-1");
        assert_eq!(result.excerpts[4].meeting_id, "new-5");
        assert!(recent_sources(&pool, Some(1)).await.is_err());
    }

    #[tokio::test]
    async fn recent_sources_refuse_oversized_unicode_and_handle_no_saved_text() {
        let pool = fixture().await;
        sqlx::query("UPDATE meeting_notes SET notes_markdown = ? WHERE meeting_id = 'B'")
            .bind("界".repeat(41000)).execute(&pool).await.unwrap();
        assert!(recent_sources(&pool, None).await.unwrap_err().contains("No source text was cut off"));
        sqlx::query("UPDATE meeting_notes SET notes_markdown = ''").execute(&pool).await.unwrap();
        let empty = recent_sources(&pool, Some(7)).await.unwrap();
        assert_eq!(empty.total_meetings, 0);
        assert!(empty.excerpts.is_empty());
    }

    #[tokio::test]
    async fn trash_hides_sources_from_discovery_and_assistant_until_restored() {
        let pool = fixture().await;
        crate::meetnola::trash::trash(&pool, "A").await.unwrap();
        let terms = vec!["comet".to_owned()];
        assert!(search(&pool, &terms, None).await.unwrap().iter().all(|hit| hit.meeting_id == "B"));
        let hits = search_meetings(&pool, "comet", 0, None).await.unwrap();
        assert_eq!(hits.meetings.len(), 1);
        assert_eq!(hits.meetings[0].meeting_id, "B");
        assert!(search_meetings(&pool, "Alpha", 0, None).await.unwrap().meetings.is_empty());
        assert!(search_match(&pool, "A", "a", "transcript", "comet").await.unwrap().is_none());
        crate::meetnola::trash::restore(&pool, "A").await.unwrap();
        assert_eq!(search_meetings(&pool, "comet", 0, None).await.unwrap().meetings.len(), 2);
        assert!(search(&pool, &terms, None).await.unwrap().iter().any(|hit| hit.meeting_id == "A"));
        assert!(search_match(&pool, "A", "a", "transcript", "comet").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn folder_search_filters_sources_before_paging() {
        let pool = fixture().await;
        sqlx::raw_sql("INSERT INTO note_folders VALUES ('folder', 'Project', 'project', '');
            INSERT INTO note_folder_members VALUES ('folder', 'A');").execute(&pool).await.unwrap();
        assert_eq!(search_meetings(&pool, "comet", 0, Some("folder")).await.unwrap().meetings[0].meeting_id, "A");
        assert_eq!(search_meetings(&pool, "comet", 0, Some("folder")).await.unwrap().meetings.len(), 1);
        assert!(search_meetings(&pool, "budget", 0, Some("folder")).await.unwrap().meetings.is_empty());
        assert_eq!(search_meetings(&pool, "comet", 0, None).await.unwrap().meetings.len(), 2);
        for i in 0..35 {
            let id = format!("folder-{i:02}");
            sqlx::query("INSERT INTO meetings VALUES (?, 'Project folder item', '', '')").bind(&id).execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO note_folder_members VALUES ('folder', ?)").bind(&id).execute(&pool).await.unwrap();
        }
        let first = search_meetings(&pool, "folder item", 0, Some("folder")).await.unwrap();
        let second = search_meetings(&pool, "folder item", 30, Some("folder")).await.unwrap();
        assert_eq!((first.meetings.len(), second.meetings.len()), (30, 5));
        assert!(first.has_more && !second.has_more);
    }

    #[tokio::test]
    async fn meeting_discovery_includes_originals_and_empty_notes_without_duplicates() {
        let pool = fixture().await;
        sqlx::raw_sql("INSERT INTO meetings VALUES ('C', 'Empty custom title', '2026-01-01', '');
            INSERT INTO transcripts(id, meeting_id, transcript, timestamp) VALUES ('a2', 'A', 'Another comet mention.', '');")
            .execute(&pool).await.unwrap();
        let hits = search_meetings(&pool, "comet", 0, None).await.unwrap();
        assert_eq!(hits.meetings.len(), 2);
        assert!(!hits.has_more);
        assert!(hits.meetings.iter().any(|hit| hit.meeting_id == "A" && hit.kind == "transcript" && hit.text.contains("comet")));
        assert!(hits.meetings.iter().any(|hit| hit.meeting_id == "B" && hit.kind == "notes" && hit.text.contains("proposed")));
        let titles = search_meetings(&pool, "custom", 0, None).await.unwrap();
        assert_eq!(titles.meetings[0].meeting_id, "C");
        assert_eq!(titles.meetings[0].kind, "title");
        assert!(titles.meetings[0].source_id.is_none());
        assert!(search_meetings(&pool, "   ", 0, None).await.unwrap().meetings.is_empty());
        assert!(search_meetings(&pool, "unknownterm", 0, None).await.unwrap().meetings.is_empty());
        assert!(search_meetings(&pool, "\" OR *", 0, None).await.unwrap().meetings.is_empty());
        assert!(search_meetings(&pool, &"x".repeat(201), 0, None).await.is_err());
    }

    #[tokio::test]
    async fn search_match_opens_the_exact_current_source_within_its_meeting() {
        let pool = fixture().await;
        let hits = search_meetings(&pool, "comet & launch", 0, None).await.unwrap();
        for hit in hits.meetings {
            let source_id = hit.source_id.as_deref().unwrap();
            let source = search_match(&pool, &hit.meeting_id, source_id, &hit.kind, "comet & launch").await.unwrap().unwrap();
            assert_eq!(source.source_id.as_deref(), Some(source_id));
            assert_eq!(source.kind, hit.kind);
            assert!(source.text.to_lowercase().contains("comet"));
        }
        assert!(search_match(&pool, "B", "a", "transcript", "comet").await.unwrap().is_none());
        assert!(search_match(&pool, "A", "a", "notes", "comet").await.unwrap().is_none());
        assert!(search_match(&pool, "A", "a", "title", "comet").await.is_err());
        assert!(search_match(&pool, "A", "a", "transcript", "unknownterm").await.unwrap().is_none());
        sqlx::query("UPDATE transcripts SET transcript = 'The comet launch moved to Friday.' WHERE id = 'a'").execute(&pool).await.unwrap();
        let source = search_match(&pool, "A", "a", "transcript", "comet").await.unwrap().unwrap();
        assert!(source.text.contains("Friday"));
        assert_eq!(source.audio_start_time, Some(45.0));
        sqlx::query("DELETE FROM transcripts WHERE id = 'a'").execute(&pool).await.unwrap();
        assert!(search_match(&pool, "A", "a", "transcript", "comet").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn meeting_discovery_accepts_punctuation_without_expanding_search_operators() {
        let pool = fixture().await;
        sqlx::raw_sql("INSERT INTO meetings VALUES ('C', 'C++ notes', '2026-01-01', ''),
            ('D', '100% complete', '2026-01-01', ''), ('E', 'Ordinary note', '2026-01-01', '');")
            .execute(&pool).await.unwrap();
        for query in ["comet & budget", "comet / budget", "\"comet\"", "comet — budget", "comet 📝 budget"] {
            let hits = search_meetings(&pool, query, 0, None).await.unwrap();
            let ids: std::collections::HashSet<_> = hits.meetings.iter().map(|hit| hit.meeting_id.as_str()).collect();
            assert_eq!(ids, std::collections::HashSet::from(["A", "B"]), "{query}");
            assert!(!hits.has_more);
        }
        // Symbol-only queries can find literal titles, but never act as LIKE or FTS wildcards.
        for (query, expected) in [("++", "C"), ("%", "D")] {
            let hits = search_meetings(&pool, query, 0, None).await.unwrap();
            assert_eq!(hits.meetings.len(), 1, "{query}");
            assert_eq!(hits.meetings[0].meeting_id, expected);
            assert_eq!(hits.meetings[0].kind, "title");
        }
        for query in ["&", "*", "_", "\" OR *", "missing OR comet", "NOT comet"] {
            let hits = search_meetings(&pool, query, 0, None).await.unwrap();
            // The literal word comet matches A and B; operators cannot expand to other meetings.
            let expected = if query.contains("comet") { 2 } else { 0 };
            assert_eq!(hits.meetings.len(), expected, "{query}");
            assert!(hits.meetings.iter().all(|hit| hit.meeting_id == "A" || hit.meeting_id == "B"));
        }
        assert!(search_meetings(&pool, &"word ".repeat(25), 0, None).await.is_err());
        assert!(search_meetings(&pool, &"x".repeat(81), 0, None).await.is_err());
    }

    #[tokio::test]
    async fn meeting_discovery_pages_unique_meetings_and_reflects_source_changes() {
        let pool = fixture().await;
        for i in 0..65 {
            sqlx::query("INSERT INTO meetings VALUES (?, 'Synthetic library entry', '2026-01-01', '')")
                .bind(format!("page-{i:02}")).execute(&pool).await.unwrap();
        }
        let first = search_meetings(&pool, "library", 0, None).await.unwrap();
        let second = search_meetings(&pool, "library", 30, None).await.unwrap();
        let last = search_meetings(&pool, "library", 60, None).await.unwrap();
        assert_eq!((first.meetings.len(), second.meetings.len(), last.meetings.len()), (30, 30, 5));
        assert!(first.has_more && second.has_more && !last.has_more);
        let ids: std::collections::HashSet<_> = first.meetings.iter().chain(&second.meetings).chain(&last.meetings).map(|m| &m.meeting_id).collect();
        assert_eq!(ids.len(), 65);
        sqlx::query("UPDATE meeting_notes SET notes_markdown = 'Café launch changed.' WHERE meeting_id = 'B'").execute(&pool).await.unwrap();
        assert_eq!(search_meetings(&pool, "cafe", 0, None).await.unwrap().meetings[0].meeting_id, "B");
        sqlx::query("DELETE FROM meetings WHERE id = 'B'").execute(&pool).await.unwrap();
        assert!(search_meetings(&pool, "cafe", 0, None).await.unwrap().meetings.is_empty());
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
