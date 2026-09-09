//! Summary pipeline regressions and opt-in, synthetic local model evaluations.
//! Phrase checks are bounded regressions, not a substitute for reviewing the prose.
use super::{llm_client::LLMProvider, processor::generate_meeting_summary, templates::Template};
use serde::Deserialize;

#[derive(Deserialize)]
struct Case {
    id: String,
    text: String,
    notes: String,
    required_any: Vec<Vec<String>>,
    absent: Vec<String>,
    #[serde(default)]
    action_absent: Vec<String>,
    #[serde(default)]
    section_required_any: std::collections::BTreeMap<String, Vec<Vec<String>>>,
    max_words: usize,
}

fn summary_section(markdown: &str, title: &str) -> String {
    let titles = ["summary", "key decisions", "action items", "discussion highlights"];
    let mut found = false;
    let mut content = Vec::new();
    for line in markdown.lines() {
        let trimmed = line.trim();
        let heading = trimmed.trim_start_matches('#').trim().trim_end_matches(':')
            .trim_matches('*').trim_end_matches(':').trim();
        if (trimmed.starts_with('#') || trimmed.starts_with("**")) && titles.contains(&heading) {
            if found { break; }
            found = heading == title;
        } else if found {
            content.push(line);
        }
    }
    content.join("\n")
}

fn evaluate_case(case: &Case, answer: &str) -> Vec<String> {
    let lower = answer.to_lowercase();
    let mut failures = Vec::new();
    for alternatives in &case.required_any {
        if !alternatives.iter().any(|value| lower.contains(&value.to_lowercase())) {
            failures.push(format!("Missing fact: {}", alternatives.join(" / ")));
        }
    }
    for forbidden in &case.absent {
        if lower.contains(&forbidden.to_lowercase()) {
            failures.push(format!("Unsupported or disallowed claim: {forbidden}"));
        }
    }
    let actions = summary_section(&lower, "action items");
    for forbidden in &case.action_absent {
        if actions.contains(&forbidden.to_lowercase()) {
            failures.push(format!("Disallowed action content: {forbidden}"));
        }
    }
    for (section, required) in &case.section_required_any {
        let text = summary_section(&lower, &section.to_lowercase());
        for alternatives in required {
            if !alternatives.iter().any(|value| text.contains(&value.to_lowercase())) {
                failures.push(format!("Missing fact in {section}: {}", alternatives.join(" / ")));
            }
        }
    }
    let words = answer.split_whitespace().count();
    if words > case.max_words {
        failures.push(format!("Over-expansion: {words} words (limit {})", case.max_words));
    }
    failures
}

#[test]
fn mentioning_the_right_person_elsewhere_does_not_validate_the_action_owner() {
    let cases: Vec<Case> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/summary-quality.json"
    )).unwrap();
    let case = cases.iter().find(|case| case.id == "conditional-offer-and-confirmed-task").unwrap();
    for heading in ["**Action Items**", "## Action Items", "**Action Items**:"] {
        let draft = format!("**Summary**\nCasey offered to write the announcement. Encryption rollout approved.\n\n{heading}\n- [ ] Export attendance by Wednesday (Dana)\n\n**Discussion Highlights**\nCasey is mentioned here too.");
        let failures = evaluate_case(case, &draft);
        assert!(failures.iter().any(|failure| failure == "Missing fact in Action Items: Casey"));
        assert!(failures.iter().any(|failure| failure == "Disallowed action content: Dana"));
        let corrected = draft.replace("Wednesday (Dana)", "Wednesday (Casey)");
        assert!(evaluate_case(case, &corrected).is_empty());
    }
}

#[test]
fn a_preservation_check_does_not_validate_an_invented_implementation_task() {
    let cases: Vec<Case> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/summary-quality.json"
    )).unwrap();
    let case = cases.iter().find(|case| case.id == "sparse-title-check").unwrap();
    let report = "## Summary\nThe check requires preserving the custom meeting title when saving.\n\n## Key Decisions\nNone noted.\n\n## Action Items\nNone noted.\n\n## Discussion Highlights\nSynthetic notes have a different first line.";
    assert!(evaluate_case(case, report).is_empty());
    let faithful_checklist = report.replace(
        "## Action Items\nNone noted.",
        "## Action Items\n- [ ] Preserve the custom meeting title when saving.",
    );
    assert!(evaluate_case(case, &faithful_checklist).is_empty());
    let invented = report.replace(
        "## Action Items\nNone noted.",
        "## Action Items\n- [ ] Implement a feature to preserve the custom meeting title.",
    );
    assert!(evaluate_case(case, &invented).iter().any(|failure| {
        failure == "Disallowed action content: implement"
    }));
}

#[test]
fn reassignment_paraphrases_still_require_the_new_action_owner_and_deadline() {
    let cases: Vec<Case> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/summary-quality.json"
    )).unwrap();
    let case = cases.iter().find(|case| case.id == "reassigned-task-and-corrected-deadline").unwrap();
    let report = "## Summary\nThe capacity report assignment was moved from Noah to Liam.\n\n## Action Items\n- [ ] Deliver the capacity report (Liam, Tuesday)";
    assert!(evaluate_case(case, report).is_empty());
    let incorrect = report.replace("(Liam, Tuesday)", "(Noah, Monday)");
    let failures = evaluate_case(case, &incorrect);
    assert!(failures.iter().any(|failure| failure == "Disallowed action content: Noah"));
    assert!(failures.iter().any(|failure| failure == "Missing fact in Action Items: Tuesday"));
}

#[tokio::test]
#[ignore = "Calls the local Ollama model; run explicitly when evaluating follow-up answers"]
async fn live_meeting_follow_up_quality() {
    use super::llm_client::{query_with_context, MeetingExchange};
    let client = reqwest::Client::new();
    let model = std::env::var("MEETNOLA_EVAL_MODEL").unwrap_or_else(|_| "gemma4:e4b-mlx".into());
    let context = "[S1] Written notes\nPreserve the custom meeting title when saving. No implementation task, owner, or deadline was assigned.\n\n[S2] Transcript · 0:30\nKeep local Parakeet for transcription.";
    let question = "What must be preserved when saving?";
    let first = query_with_context(&client, &LLMProvider::Ollama, &model, "", context,
        question, &[], Some("http://localhost:11434"), None, None).await.unwrap();
    let history = [MeetingExchange { question: question.into(), answer: first.replace("[S1](#source-S1)", "") }];
    let follow_up = query_with_context(&client, &LLMProvider::Ollama, &model, "", context,
        "Turn that into one short reminder.", &history, Some("http://localhost:11434"), None, None).await.unwrap();
    // A prior generated answer must not become evidence for an invented assignment.
    let incorrect_history = [MeetingExchange {
        question: "What was assigned?".into(),
        answer: "Morgan agreed to implement title preservation by Friday.".into(),
    }];
    let correction = query_with_context(&client, &LLMProvider::Ollama, &model, "", context,
        "Was that actually assigned in the meeting?", &incorrect_history,
        Some("http://localhost:11434"), None, None).await.unwrap();
    println!("{}", serde_json::json!({"model": model, "first": first, "follow_up": follow_up, "correction": correction}));
    assert!(first.to_lowercase().contains("custom meeting title"));
    assert!(follow_up.to_lowercase().contains("title"));
    assert!(!follow_up.to_lowercase().contains("parakeet"));
    assert!(follow_up.contains("#source-S1"));
    assert!(follow_up.split_whitespace().count() <= 50);
    assert!(correction.to_lowercase().contains("no") || correction.to_lowercase().contains("not"));
    assert!(correction.contains("#source-S1"));
}

#[tokio::test]
#[ignore = "Calls the local Ollama model; run explicitly when evaluating summary quality"]
async fn live_summary_quality() {
    let cases: Vec<Case> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/summary-quality.json"
    )).unwrap();
    let template: Template = serde_json::from_str(include_str!(
        "../../templates/standard_meeting.json"
    )).unwrap();
    let client = reqwest::Client::new();
    let model = std::env::var("MEETNOLA_EVAL_MODEL").unwrap_or_else(|_| "qwen3.5:4b-mlx".into());
    let output = std::env::var("MEETNOLA_EVAL_REPORT")
        .unwrap_or_else(|_| "/private/tmp/meetnola-summary-quality.json".into());
    let mut results = Vec::new();
    for case in cases {
        let started = std::time::Instant::now();
        let notes = if case.notes.is_empty() {
            String::new()
        } else {
            format!("Use the typed meeting notes below as additional context alongside the transcript. Preserve the user-written intent, merge overlapping points, and do not invent facts.\n\nTyped meeting notes:\n{}", case.notes)
        };
        let result = generate_meeting_summary(
            &client, &LLMProvider::Ollama, &model, "", &case.text, &notes,
            "standard_meeting", &template, 4000, Some("http://localhost:11434"),
            None, None, None, None, None, None, Some("en"), Some("en"), None,
        ).await;
        let (answer, mut failures) = match result {
            Ok((answer, _, _)) => (answer, vec![]),
            Err(error) => (String::new(), vec![error]),
        };
        failures.extend(evaluate_case(&case, &answer));
        let words = answer.split_whitespace().count();
        eprintln!("{}: {:.2}s, {} checks failed", case.id, started.elapsed().as_secs_f64(), failures.len());
        results.push(serde_json::json!({
            "case": case.id,
            "model": model,
            "seconds": started.elapsed().as_secs_f64(),
            "words": words,
            "failures": failures,
            "answer": answer,
        }));
        std::fs::write(&output, serde_json::to_string_pretty(&results).unwrap()).unwrap();
    }
    let report = serde_json::to_string_pretty(&results).unwrap();
    println!("{report}");
    assert!(
        results.iter().all(|row| row["failures"].as_array().unwrap().is_empty()),
        "Summary quality checks failed; inspect the report, including the actual prose."
    );
}

#[test]
fn sentence_boundary_chunking_covers_the_entire_unicode_source() {
    let text = format!("Opening. {}", (0..200).map(|i| format!("項目{i} ")).collect::<String>());
    let chunks = super::processor::chunk_text(&text, 100, 10);
    assert!(chunks.len() > 1);
    let mut covered = 0;
    for chunk in chunks {
        let start = text.find(&chunk).unwrap();
        assert!(start <= covered, "Source text was skipped before byte {start}");
        covered = covered.max(start + chunk.len());
    }
    assert_eq!(covered, text.len());
}

#[tokio::test]
async fn failed_transcript_part_never_produces_a_partial_report() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(AtomicUsize::new(0));
    let server_calls = calls.clone();
    let server = tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let read = stream.read(&mut buffer).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                    let length: usize = headers.lines().find_map(|line| {
                        line.strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse().ok())
                    }).unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let body_start = request.windows(4).position(|part| part == b"\r\n\r\n").unwrap() + 4;
            let body: serde_json::Value = serde_json::from_slice(&request[body_start..]).unwrap();
            assert_eq!(body["reasoning_effort"], "none");
            assert_eq!(body["temperature"].as_f64().unwrap() as f32, 0.2);
            let index = server_calls.fetch_add(1, Ordering::SeqCst);
            let (status, body) = if index == 1 {
                ("500 Internal Server Error", r#"{"error":"synthetic failed part"}"#)
            } else {
                ("200 OK", r#"{"choices":[{"message":{"content":"Local transcription retained."}}]}"#)
            };
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            stream.write_all(response.as_bytes()).await.unwrap();
        }
    });
    let template: Template = serde_json::from_str(include_str!("../../templates/standard_meeting.json")).unwrap();
    let text = "Keep transcription local. Morgan will verify the saved notes by Friday. ".repeat(40);
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), generate_meeting_summary(
        &reqwest::Client::new(), &LLMProvider::Ollama, "qwen3.5:4b-mlx", "", &text, "",
        "standard_meeting", &template, 600, Some(&endpoint),
        None, None, None, None, None, None, Some("en"), Some("en"), None,
    )).await;
    server.abort();
    let error = result.expect("Pipeline should finish promptly").unwrap_err();
    assert!(error.contains("transcript part 2 of"), "{error}");
    assert_eq!(calls.load(Ordering::SeqCst), 2, "Do not synthesize a report after losing source material");
}
