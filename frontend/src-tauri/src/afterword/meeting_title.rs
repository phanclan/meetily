//! Background meeting titles from a cheap Gateway model.
//!
//! Enhance keeps Luna. This path names the note from notes/transcript using
//! `openai/gpt-5-nano` and per-request Zero Data Retention (not the paid
//! team-wide toggle). User-edited titles are never replaced.

use crate::afterword::defaults::{self, TITLE_MODEL};
use crate::database::repositories::notes::NotesRepository;
use crate::database::repositories::setting::SettingsRepository;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};
use tracing::{info, warn};

const MAX_INPUT_CHARS: usize = 4000;
const MIN_SOURCE_CHARS: usize = 32;
const MAX_TITLE_WORDS: usize = 12;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const DEBOUNCE: Duration = Duration::from_millis(1500);

static GENERATION: Lazy<Mutex<HashMap<String, u64>>> = Lazy::new(|| Mutex::new(HashMap::new()));

const SYSTEM_PROMPT: &str = "You name meetings so they can be found in a list.\n\
Rules:\n\
- 3 to 7 words, sentence case.\n\
- Name the topic and people, not \"meeting\", \"review\", or \"discussion\".\n\
- Keep product names, people, and numbers exact.\n\
- No quotes, no trailing punctuation, no \"Title:\" prefix.\n\
Reply with JSON only: {\"title\": \"...\"}";

pub fn is_generated_or_placeholder_title(title: &str) -> bool {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return true;
    }

    if matches!(
        trimmed,
        "New note"
            | "+ New Call"
            | "Untitled meeting"
            | "Untitled"
            | "Untitled Meeting"
            | "New Meeting"
    ) {
        return true;
    }

    let rest = match trimmed.strip_prefix("Meeting ") {
        Some(rest) => rest,
        None => return false,
    };

    let bytes = rest.as_bytes();
    let legacy = bytes.len() == 19
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'_'
        && bytes[13] == b'-'
        && bytes[16] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13 | 16) || byte.is_ascii_digit());
    if legacy {
        return true;
    }

    bytes.len() == 17
        && bytes[2] == b'_'
        && bytes[5] == b'_'
        && bytes[8] == b'_'
        && bytes[11] == b'_'
        && bytes[14] == b'_'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 2 | 5 | 8 | 11 | 14) || byte.is_ascii_digit())
}

pub fn derive_title_from_notes(notes_markdown: &str) -> Option<String> {
    for line in notes_markdown.lines() {
        let candidate = normalize_title_line(line);
        if candidate.len() < 4 {
            continue;
        }
        if candidate.starts_with("http://") || candidate.starts_with("https://") {
            continue;
        }

        let mut title = candidate;
        if title.len() > 96 {
            title = title.chars().take(96).collect::<String>().trim().to_string();
            if let Some(last_space) = title.rfind(' ') {
                title.truncate(last_space);
            }
        }

        if !title.is_empty() {
            return Some(title);
        }
    }
    None
}

fn normalize_title_line(line: &str) -> String {
    let trimmed = line.trim();
    let without_heading = trimmed.trim_start_matches('#').trim();
    let without_bullet = without_heading
        .trim_start_matches("- ")
        .trim_start_matches("* ")
        .trim_start_matches("> ")
        .trim_start_matches("[ ] ")
        .trim_start_matches("[x] ")
        .trim();

    let without_numbered = without_bullet
        .find(". ")
        .filter(|index| without_bullet[..*index].chars().all(|c| c.is_ascii_digit()))
        .map(|index| without_bullet[index + 2..].trim())
        .unwrap_or(without_bullet);

    without_numbered
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn is_title_replaceable(current: &str, notes: &str) -> bool {
    if is_generated_or_placeholder_title(current) {
        return true;
    }
    derive_title_from_notes(notes).is_some_and(|derived| derived == current.trim())
}

pub fn gateway_title_credentials(endpoint: &str, api_key: Option<&str>) -> Option<(String, String)> {
    let key = api_key.map(str::trim).filter(|value| !value.is_empty())?;
    if !defaults::is_gateway_endpoint(endpoint) {
        return None;
    }
    Some((endpoint.trim().trim_end_matches('/').to_string(), key.to_string()))
}

pub fn source_snippet(notes: &str, transcript: &str) -> Option<String> {
    let notes = truncate_chars(notes.trim(), MAX_INPUT_CHARS / 2);
    let transcript = truncate_chars(transcript.trim(), MAX_INPUT_CHARS / 2);
    let mut parts = Vec::new();
    if !notes.is_empty() {
        parts.push(format!("Notes:\n{notes}"));
    }
    if !transcript.is_empty() {
        parts.push(format!("Transcript:\n{transcript}"));
    }
    let snippet = parts.join("\n\n");
    let substantial = snippet.chars().filter(|ch| ch.is_alphanumeric()).count();
    if substantial < MIN_SOURCE_CHARS {
        return None;
    }
    Some(truncate_chars(&snippet, MAX_INPUT_CHARS))
}

pub fn title_request_body(snippet: &str) -> Value {
    json!({
        "model": TITLE_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": snippet}
        ],
        "max_tokens": 64,
        "temperature": 0.3,
        "reasoning_effort": "minimal",
        "response_format": {"type": "json_object"},
        "providerOptions": {
            "gateway": {
                "zeroDataRetention": true,
                "tags": ["feature:meeting-title"]
            }
        }
    })
}

pub fn parse_generated_title(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let unfenced = strip_fence(trimmed);
    if let Ok(value) = serde_json::from_str::<Value>(unfenced) {
        if let Some(title) = value.get("title").and_then(Value::as_str) {
            return clean_title(title);
        }
    }
    clean_title(unfenced)
}

fn strip_fence(raw: &str) -> &str {
    let trimmed = raw.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let rest = rest.strip_prefix("json").unwrap_or(rest).trim_start();
    rest.strip_suffix("```").map(str::trim).unwrap_or(rest)
}

fn clean_title(raw: &str) -> Option<String> {
    let mut title = raw.trim().trim_matches('"').trim_matches('\'').trim();
    title = title.trim_start_matches("Title:").trim();
    let words: Vec<&str> = title.split_whitespace().collect();
    if words.is_empty() || words.len() > MAX_TITLE_WORDS {
        return None;
    }
    let mut joined = words.join(" ");
    while joined.ends_with(['.', '!', '?', ',', ';', ':']) {
        joined.pop();
        joined = joined.trim_end().to_string();
    }
    if joined.chars().count() > 96 {
        joined = joined.chars().take(96).collect::<String>().trim().to_string();
        if let Some(last_space) = joined.rfind(' ') {
            joined.truncate(last_space);
        }
    }
    if joined.len() < 4 || is_generated_or_placeholder_title(&joined) {
        return None;
    }
    Some(joined)
}

fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max).collect();
    if let Some(last_space) = out.rfind(' ') {
        out.truncate(last_space);
    }
    out
}

pub fn schedule_generated_title<R: Runtime>(app: AppHandle<R>, pool: SqlitePool, meeting_id: String) {
    if meeting_id.trim().is_empty() {
        return;
    }
    let generation = {
        let mut generations = GENERATION.lock().expect("title generation map");
        let next = generations.entry(meeting_id.clone()).or_insert(0);
        *next += 1;
        *next
    };
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(DEBOUNCE).await;
        let current = GENERATION
            .lock()
            .ok()
            .and_then(|generations| generations.get(&meeting_id).copied());
        if current != Some(generation) {
            return;
        }
        match generate_and_apply(&app, &pool, &meeting_id).await {
            Ok(Some((previous_title, title))) => {
                info!("Named meeting {meeting_id} from Gateway nano");
                if let Err(error) = app.emit(
                    "meeting-title-suggested",
                    json!({
                        "meeting_id": meeting_id,
                        "title": title,
                        "previous_title": previous_title,
                    }),
                ) {
                    warn!("Could not publish suggested meeting title: {error}");
                }
            }
            Ok(None) => {}
            Err(error) => warn!("Meeting title generation skipped for {meeting_id}: {error}"),
        }
    });
}

async fn generate_and_apply<R: Runtime>(
    _app: &AppHandle<R>,
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<Option<(String, String)>, String> {
    let Some(job) = prepare_title_job(pool, meeting_id).await? else {
        return Ok(None);
    };
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not build title client: {error}"))?;
    let url = format!("{}/chat/completions", job.endpoint);
    let response = client
        .post(&url)
        .bearer_auth(&job.api_key)
        .json(&title_request_body(&job.snippet))
        .send()
        .await
        .map_err(|error| format!("Title request failed: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let preview: String = body.chars().take(200).collect();
        return Err(format!("Title request failed ({status}): {preview}"));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Could not parse title response: {error}"))?;
    let raw = message_content(&payload).ok_or_else(|| "Title model returned no text".to_string())?;
    let title = parse_generated_title(&raw).ok_or_else(|| "Title model returned an unusable name".to_string())?;
    if !apply_suggested_title(pool, meeting_id, &job.previous_title, &title).await? {
        return Ok(None);
    }
    Ok(Some((job.previous_title, title)))
}

struct TitleJob {
    endpoint: String,
    api_key: String,
    previous_title: String,
    snippet: String,
}

async fn prepare_title_job(pool: &SqlitePool, meeting_id: &str) -> Result<Option<TitleJob>, String> {
    let config = SettingsRepository::get_custom_openai_config(pool)
        .await
        .map_err(|error| format!("Could not load Gateway config: {error}"))?;
    let Some(config) = config else {
        return Ok(None);
    };
    let Some((endpoint, api_key)) = gateway_title_credentials(&config.endpoint, config.api_key.as_deref()) else {
        return Ok(None);
    };

    let title = sqlx::query_scalar::<_, String>(
        "SELECT title FROM meetings WHERE id = ? AND NOT EXISTS(SELECT 1 FROM meeting_trash WHERE meeting_id = meetings.id)",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Could not read meeting title: {error}"))?;
    let Some(previous_title) = title else {
        return Ok(None);
    };

    let notes = NotesRepository::get_notes(pool, meeting_id)
        .await
        .map_err(|error| format!("Could not read notes: {error}"))?
        .and_then(|notes| notes.notes_markdown)
        .unwrap_or_default();
    if !is_title_replaceable(&previous_title, &notes) {
        return Ok(None);
    }

    let transcripts: Vec<String> = sqlx::query_scalar(
        "SELECT transcript FROM transcripts WHERE meeting_id = ? ORDER BY COALESCE(audio_start_time, 0), id",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Could not read transcript: {error}"))?;
    let Some(snippet) = source_snippet(&notes, &transcripts.join("\n")) else {
        return Ok(None);
    };

    Ok(Some(TitleJob {
        endpoint,
        api_key,
        previous_title,
        snippet,
    }))
}

fn message_content(payload: &Value) -> Option<String> {
    let content = &payload["choices"][0]["message"]["content"];
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    if let Some(parts) = content.as_array() {
        let text = parts
            .iter()
            .filter_map(|part| part["text"].as_str().or_else(|| part.as_str()))
            .collect::<Vec<_>>()
            .join("");
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

async fn apply_suggested_title(
    pool: &SqlitePool,
    meeting_id: &str,
    previous_title: &str,
    new_title: &str,
) -> Result<bool, String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not start title write: {error}"))?;
    let now = chrono::Utc::now().naive_utc();
    let updated = sqlx::query(
        "UPDATE meetings SET title = ?, updated_at = ? WHERE id = ? AND title = ?",
    )
    .bind(new_title)
    .bind(now)
    .bind(meeting_id)
    .bind(previous_title)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("Could not save suggested title: {error}"))?;
    if updated.rows_affected() == 0 {
        let _ = transaction.rollback().await;
        return Ok(false);
    }
    let _ = sqlx::query("UPDATE transcript_chunks SET meeting_name = ? WHERE meeting_id = ?")
        .bind(new_title)
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await;
    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit suggested title: {error}"))?;
    Ok(true)
}

#[cfg(test)]
mod quality_tests {
    use super::*;

    #[test]
    fn placeholder_detection_matches_afterword_titles() {
        assert!(is_generated_or_placeholder_title("Meeting 12_09_26_23_04_55"));
        assert!(is_generated_or_placeholder_title("Meeting 2026-09-12_23-04-55"));
        assert!(is_generated_or_placeholder_title("New note"));
        assert!(!is_generated_or_placeholder_title("Navi UI redesign with Cynthia"));
    }

    #[test]
    fn first_line_titles_remain_replaceable() {
        let notes = "Ship Navi iframe removal by Friday\nMore detail";
        assert!(is_title_replaceable("Ship Navi iframe removal by Friday", notes));
        assert!(!is_title_replaceable("Custom customer meeting", notes));
    }

    #[test]
    fn snippet_requires_substance() {
        assert!(source_snippet("hi", "").is_none());
        let snippet = source_snippet(
            "Discussed Navi workspace switcher with Cynthia and delayed iframe removal.",
            "",
        )
        .unwrap();
        assert!(snippet.contains("Notes:"));
        assert!(snippet.contains("Cynthia"));
    }

    #[test]
    fn request_uses_nano_and_per_request_zdr() {
        let body = title_request_body("Notes:\nTalked about Navi");
        assert_eq!(body["model"], TITLE_MODEL);
        assert_eq!(body["model"], "openai/gpt-5-nano");
        assert_ne!(body["model"], "openai/gpt-5.6-luna");
        assert_eq!(body["max_tokens"], 64);
        assert_eq!(body["reasoning_effort"], "minimal");
        assert_eq!(body["providerOptions"]["gateway"]["zeroDataRetention"], true);
        assert_eq!(body["providerOptions"]["gateway"]["tags"][0], "feature:meeting-title");
        assert!(body.get("teamWideZeroDataRetention").is_none());
    }

    #[test]
    fn gateway_credentials_require_vercel_endpoint_and_key() {
        assert!(gateway_title_credentials("https://ai-gateway.vercel.sh/v1", Some("k")).is_some());
        assert!(gateway_title_credentials("https://ai-gateway.vercel.sh/v1/", Some("k")).is_some());
        assert!(gateway_title_credentials("http://localhost:11434/v1", Some("k")).is_none());
        assert!(gateway_title_credentials("https://ai-gateway.vercel.sh/v1", Some("")).is_none());
        assert!(gateway_title_credentials("https://ai-gateway.vercel.sh/v1", None).is_none());
    }

    #[test]
    fn parses_json_titles_and_rejects_generic_or_long_ones() {
        assert_eq!(
            parse_generated_title("{\"title\":\"Navi UI redesign with Cynthia\"}").as_deref(),
            Some("Navi UI redesign with Cynthia")
        );
        assert_eq!(
            parse_generated_title("```json\n{\"title\":\"Vault docs review\"}\n```").as_deref(),
            Some("Vault docs review")
        );
        assert!(parse_generated_title("{\"title\":\"New note\"}").is_none());
        assert!(parse_generated_title("{\"title\":\"hi\"}").is_none());
        assert!(parse_generated_title(
            "{\"title\":\"Investigate and then completely rewrite the entire Navi workspace switcher for every customer\"}"
        )
        .is_none());
    }

    #[tokio::test]
    async fn suggested_title_does_not_overwrite_a_newer_custom_name() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, updated_at TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE transcript_chunks (meeting_id TEXT, meeting_name TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO meetings (id, title, updated_at) VALUES ('m1', 'Meeting 14_09_26_07_00_00', 't')")
            .execute(&pool)
            .await
            .unwrap();
        assert!(apply_suggested_title(&pool, "m1", "Meeting 14_09_26_07_00_00", "Navi UI redesign with Cynthia")
            .await
            .unwrap());
        sqlx::query("UPDATE meetings SET title = 'Custom customer meeting' WHERE id = 'm1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!apply_suggested_title(&pool, "m1", "Meeting 14_09_26_07_00_00", "Late nano title")
            .await
            .unwrap());
        let stored: String = sqlx::query_scalar("SELECT title FROM meetings WHERE id = 'm1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, "Custom customer meeting");
    }
}
