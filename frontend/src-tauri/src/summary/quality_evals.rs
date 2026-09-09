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
    #[serde(default)]
    section_absent: std::collections::BTreeMap<String, Vec<String>>,
    // Each group of alternatives must match within the same action item.
    #[serde(default)]
    action_required_together: Vec<Vec<Vec<String>>>,
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

// Keep wrapped lines with their task, but never satisfy an owner/deadline check
// with facts from another checklist item. These are bounded lexical checks.
fn action_entries(actions: &str) -> Vec<String> {
    let mut entries: Vec<String> = Vec::new();
    for line in actions.lines().filter(|line| !line.trim().is_empty()) {
        let trimmed = line.trim();
        let numbered = trimmed.split_once('.').map_or(false, |(prefix, rest)| {
            !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit()) && rest.starts_with(' ')
        });
        if entries.is_empty() || trimmed.starts_with("- ") || trimmed.starts_with("* ") || numbered {
            entries.push(trimmed.to_owned());
        } else if let Some(entry) = entries.last_mut() {
            entry.push(' ');
            entry.push_str(trimmed);
        }
    }
    entries
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
    let entries = action_entries(&actions);
    for requirement in &case.action_required_together {
        if !entries.iter().any(|entry| requirement.iter().all(|alternatives| {
            alternatives.iter().any(|value| entry.contains(&value.to_lowercase()))
        })) {
            failures.push(format!("Missing task/owner/deadline together: {:?}", requirement));
        }
    }
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
    for (section, forbidden) in &case.section_absent {
        let text = summary_section(&lower, &section.to_lowercase());
        for value in forbidden {
            if text.contains(&value.to_lowercase()) {
                failures.push(format!("Disallowed content in {section}: {value}"));
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
        let draft = format!("**Summary**\nCasey offered to write the announcement. Encryption rollout approved.\n\n**Key Decisions**\nEncryption rollout approved.\n\n{heading}\n- [ ] Export attendance by Wednesday (Dana)\n\n**Discussion Highlights**\nCasey is mentioned here too.");
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
        question, &[], Some("http://localhost:11434"), None, None, None, None).await.unwrap();
    let history = [MeetingExchange { question: question.into(), answer: first.replace("[S1](#source-S1)", "") }];
    let follow_up = query_with_context(&client, &LLMProvider::Ollama, &model, "", context,
        "Turn that into one short reminder.", &history, Some("http://localhost:11434"), None, None, None, None).await.unwrap();
    // A prior generated answer must not become evidence for an invented assignment.
    let incorrect_history = [MeetingExchange {
        question: "What was assigned?".into(),
        answer: "Morgan agreed to implement title preservation by Friday.".into(),
    }];
    let correction = query_with_context(&client, &LLMProvider::Ollama, &model, "", context,
        "Was that actually assigned in the meeting?", &incorrect_history,
        Some("http://localhost:11434"), None, None, None, None).await.unwrap();
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
    let model = std::env::var("MEETNOLA_EVAL_MODEL").unwrap_or_else(|_| "gemma4:e4b-mlx".into());
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

// Keep changes of ownership far apart so the production multi-part path, rather
// than just the short-input prompt, must reconcile them. All content is synthetic.
fn long_meeting_case() -> Case {
    let mut text = String::from("[00:04] Avery: Noah owns the capacity report, due Monday. The $900 expansion budget is proposed only; no approval has been given.\n");
    let topics = [
        "The export review covered Japanese and Arabic names. Stored records remain intact; the defect affects CSV output only. The sample file is a reproduction artifact, not evidence that customer data was lost.",
        "The operations review compared the current queue with the prior sample. These are observations, not a change to the service target. The team has not approved changing retention or dropping archived records.",
        "The dashboard review distinguished completed imports from processing attempts. A retry is not another completed import. Counts from the two views should not be added together because they describe overlapping activity.",
        "The support discussion covered the wording of a draft help article. Draft wording is not a product commitment. No public release date or external announcement was agreed during this discussion.",
        "The testing discussion used synthetic participant names and sample transcripts. Real customer notes were not part of this exercise. The comparison concerns saved note behavior and does not measure transcription accuracy.",
        "The accessibility review covered keyboard focus and source excerpts. Opening a source should retain the question being read. This discussion did not assign another owner or change the existing report deadline.",
    ];
    for minute in 1..=60 {
        text.push_str(&format!("[{minute:02}:00] Review: {}\n", topics[(minute - 1) % topics.len()]));
        if minute == 30 {
            text.push_str("[30:40] Dev: I could investigate SSO, but I am not committing to that work. No one has assigned this investigation.\n");
        }
    }
    text.push_str("[61:00] Avery: The earlier assignment to Noah for Monday is canceled. Liam has accepted the capacity report, due Tuesday instead.\n[61:15] Liam: Confirmed. I will deliver the capacity report Tuesday.\n[61:30] Avery: The $900 budget remains proposed and not approved. Keep the pilot internal. No external release is approved.\n");
    Case {
        id: "long-meeting-late-reassignment".into(), text, notes: String::new(),
        required_any: vec![vec!["intact".into(), "unaffected".into()], vec!["not approved".into(), "unapproved".into(), "pending approval".into()]],
        absent: vec!["budget was rejected".into(), "budget is approved".into(), "records were lost".into()],
        action_absent: vec!["Noah".into(), "Monday".into(), "investigate SSO".into()],
        section_required_any: std::collections::BTreeMap::from([
            ("Action Items".into(), vec![vec!["Liam".into()], vec!["Tuesday".into()], vec!["capacity report".into()]]),
            ("Key Decisions".into(), vec![vec!["internal".into()]]),
        ]),
        section_absent: std::collections::BTreeMap::from([("Key Decisions".into(), vec!["budget".into()])]),
        action_required_together: vec![],
        max_words: 500,
    }
}

#[test]
fn long_meeting_fixture_requires_reconciliation_across_parts() {
    let case = long_meeting_case();
    let chunks = super::processor::chunk_text(&case.text, 3700, 100);
    assert!(chunks.len() >= 2);
    assert!(chunks[0].contains("Noah owns the capacity report"));
    assert!(!chunks[0].contains("Liam has accepted"));
    assert!(chunks.last().unwrap().contains("Liam has accepted"));
    let valid = "## Summary\nRecords remain intact. The budget is not approved.\n## Key Decisions\nKeep the pilot internal.\n## Action Items\n- [ ] Deliver the capacity report (Liam, Tuesday)";
    assert!(evaluate_case(&case, valid).is_empty());
    assert!(!evaluate_case(&case, &valid.replace("Liam, Tuesday", "Noah, Monday")).is_empty());
    let misplaced = valid.replace("Keep the pilot internal.", "Keep the pilot internal. The budget is not approved.");
    assert!(evaluate_case(&case, &misplaced).iter().any(|failure| failure == "Disallowed content in Key Decisions: budget"));
}

#[tokio::test]
#[ignore = "Calls the local MLX model through the production multi-part pipeline with synthetic text"]
async fn live_long_meeting_quality() {
    let case = long_meeting_case();
    let template: Template = serde_json::from_str(include_str!("../../templates/standard_meeting.json")).unwrap();
    let model = std::env::var("MEETNOLA_EVAL_MODEL").unwrap_or_else(|_| "gemma4:e4b-mlx".into());
    let output = std::env::var("MEETNOLA_EVAL_REPORT").unwrap_or_else(|_| "/private/tmp/meetnola-long-summary-quality.json".into());
    let endpoint = std::env::var("MEETNOLA_EVAL_ENDPOINT").unwrap_or_else(|_| "http://localhost:11434".into());
    let started = std::time::Instant::now();
    let (answer, _, chunks) = generate_meeting_summary(
        &reqwest::Client::new(), &LLMProvider::Ollama, &model, "", &case.text, "",
        "standard_meeting", &template, 4000, Some(&endpoint),
        None, None, None, None, None, None, Some("en"), Some("en"), None,
    ).await.unwrap();
    let failures = evaluate_case(&case, &answer);
    let report = serde_json::json!({"case": case.id, "model": model, "token_threshold": 4000, "input_characters": case.text.chars().count(),
        "chunks": chunks, "seconds": started.elapsed().as_secs_f64(), "failures": failures, "answer": answer});
    std::fs::write(output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("{report}");
    assert!(chunks >= 2, "This evaluation must exercise the multi-part path");
    assert!(failures.is_empty(), "Inspect the saved report and prose before accepting quality");
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

#[tokio::test]
async fn fitting_chunk_notes_reach_the_report_without_an_extra_rewrite() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let replies = [
            "Noah owns the capacity report, due Monday.",
            "The Noah/Monday assignment is canceled. Liam accepted the capacity report, due Tuesday.",
            "## Action Items\n- [ ] Deliver the capacity report (Liam, Tuesday)",
        ];
        for (index, reply) in replies.iter().enumerate() {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let body_start = loop {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = headers.lines().find_map(|line| line.strip_prefix("content-length:")
                        .and_then(|value| value.trim().parse().ok())).unwrap();
                    if bytes.len() >= end + 4 + length { break end + 4; }
                }
            };
            let request: serde_json::Value = serde_json::from_slice(&bytes[body_start..]).unwrap();
            let user = request["messages"][1]["content"].as_str().unwrap();
            if index == 2 {
                assert!(request["messages"][0]["content"].as_str().unwrap().contains("<template>"));
                let original = user.find(replies[0]).unwrap();
                let correction = user.find(replies[1]).unwrap();
                assert!(original < correction, "The final report must receive both parts in source order");
            } else {
                assert!(user.contains("<transcript_chunk>"));
            }
            let body = serde_json::json!({"choices": [{"message": {"content": reply}}]}).to_string();
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        }
    });
    let template: Template = serde_json::from_str(include_str!("../../templates/standard_meeting.json")).unwrap();
    let case = long_meeting_case();
    let (answer, _, chunks) = tokio::time::timeout(std::time::Duration::from_secs(5), generate_meeting_summary(
        &reqwest::Client::new(), &LLMProvider::Ollama, "gemma4:e4b-mlx", "", &case.text, "",
        "standard_meeting", &template, 4000, Some(&endpoint),
        None, None, None, None, None, None, Some("en"), Some("en"), None,
    )).await.unwrap().unwrap();
    server.await.unwrap();
    assert_eq!(chunks, 2);
    assert!(answer.contains("Liam, Tuesday"));
}

#[tokio::test]
#[ignore = "Requires the selected local Gemma MLX model; uses only synthetic meeting text"]
async fn live_meeting_stream_latency() {
    use super::llm_client::query_with_context;
    use std::sync::Mutex;
    use std::time::Instant;
    let client = reqwest::Client::new();
    let context = "[S1] Written notes\nPreserve the custom meeting title when saving. Parakeet Compact stays selected. Morgan will verify saved notes by Friday. No implementation work was assigned.";
    for sample in 1..=3 {
        let start = Instant::now();
        let first = Mutex::new(None);
        let emit = |text: &str| {
            if !text.trim().is_empty() { first.lock().unwrap().get_or_insert(start.elapsed()); }
            Ok(())
        };
        let answer = query_with_context(&client, &LLMProvider::Ollama, "gemma4:e4b-mlx", "", context,
            "Summarize the decisions and explicit follow-ups with citations.", &[], Some("http://localhost:11434"),
            None, None, None, Some(&emit)).await.unwrap();
        let total = start.elapsed();
        let first = first.lock().unwrap().unwrap();
        assert!(first < total);
        assert!(answer.to_lowercase().contains("title"));
        // The UI links plain markers only when the ID exists in the source snapshot.
        assert!(answer.contains("[S1]"), "Synthetic response omitted source citations: {answer}");
        println!("{}", serde_json::json!({ "sample": sample, "first_text_ms": first.as_millis(),
            "completion_ms": total.as_millis(), "words": answer.split_whitespace().count() }));
    }
}


#[test]
fn swapped_action_owners_and_dates_do_not_pass_by_appearing_elsewhere() {
    let cases: Vec<Case> = serde_json::from_str(include_str!("../../../tests/fixtures/summary-quality.json")).unwrap();
    let case = cases.iter().find(|case| case.id == "two-owners-two-deliverables").unwrap();
    let correct = "## Summary\nLaunch date is undecided.\n## Action Items\n- [ ] Rehearsal (Omar, Tuesday)\n- [ ] Release notes (Nina, Thursday)";
    assert!(evaluate_case(case, correct).is_empty());
    let swapped = correct.replace("Omar, Tuesday", "Nina, Tuesday").replace("Nina, Thursday", "Omar, Thursday");
    assert_eq!(evaluate_case(case, &swapped).len(), 2);
    let wrong_dates = correct.replace("Omar, Tuesday", "Omar, Thursday").replace("Nina, Thursday", "Nina, Tuesday");
    assert_eq!(evaluate_case(case, &wrong_dates).len(), 2);
    let wrapped = correct.replace("Rehearsal (Omar, Tuesday)", "Rehearsal\n  (Omar, Tuesday)");
    assert!(evaluate_case(case, &wrapped).is_empty());
}


#[test]
fn an_approved_decision_cannot_only_appear_in_the_overview() {
    let cases: Vec<Case> = serde_json::from_str(include_str!("../../../tests/fixtures/summary-quality.json")).unwrap();
    let case = cases.iter().find(|case| case.id == "conditional-offer-and-confirmed-task").unwrap();
    let report = "## Summary\nThe encryption rollout was approved.\n## Key Decisions\nNone noted.\n## Action Items\n- [ ] Export attendance (Casey, Wednesday)";
    assert!(evaluate_case(case, report).iter().any(|failure| failure == "Missing fact in Key Decisions: encryption"));
    let corrected = report.replace("## Key Decisions\nNone noted.", "## Key Decisions\nThe encryption rollout was approved.");
    assert!(evaluate_case(case, &corrected).is_empty());
}
