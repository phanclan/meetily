# Afterword maintenance

Decision: 2026-09-05. Afterword is maintained as an independent product fork with selective upstream adoption.

## Branch policy

- `origin` is the personal fork. `upstream` is the original Meetily repository.
- Work directly on the fork's local `main`. Create a branch or separate worktree only when Peter explicitly requests it.
- Do not routinely rebase the product branch onto upstream releases. Stashes are temporary conveniences, not release handoffs.
- Review upstream security, platform, audio, and transcription fixes. Adopt product/UI changes only when wanted.
- Integrate approved upstream changes into local `main`. Use `git cherry-pick -x` for self-contained commits; port changes explicitly when their dependencies do not fit. Preserve source attribution and existing license notices.
- Afterword tester builds disable the upstream updater feed. Distribute a verified fork build by hand until a dedicated signed release feed is established. See [Sharing Afterword](afterword-sharing.md).
- Product identity is `com.afterword.app`. App data lives in `~/Library/Application Support/com.afterword.app/`. Default recordings go to `~/Movies/afterword-recordings/`. Changing the bundle id again orphans data and macOS TCC grants.
- Validate changes with the checks below before committing. Publishing/pushing is a separate operation.

## Supported baseline

### macOS development permissions

The current dev bundle is ad-hoc signed. Its designated requirement is tied to the executable hash, so replacing the native binary can cause macOS to ask for microphone or system-audio access again even when the bundle ID and path stay unchanged. Frontend hot reload does not replace that binary. Batch native updates and use hot reload for frontend work. A stable Apple Development signing identity is the recommended development setup; no valid code-signing identity was installed when checked on September 9. Do not reset privacy permissions as routine build cleanup. See [Apple's explanation of code identity and microphone prompts](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

Recording-start elapsed time can include the user's response to an OS permission prompt. The earlier approximately 68-second start has not been separated into permission, model, and device initialization time, so it is not established as a performance regression.

### Runtime

The Tauri app and Rust core remain authoritative. Afterword's plugin owns notes, live queries, and product extensions. The archived Python backend is not part of this baseline.

Transcription uses local Parakeet or Whisper. Cloud transcription is unavailable in this recovery baseline; the Afterword selector disables Groq and explains the limitation for existing cloud configurations. Stored credentials are retained. Summary providers remain separate from transcription; their live network behavior is not established by an offline recording test.

Enhancement and meeting questions currently use Vercel AI Gateway with `openai/gpt-5.6-luna`, through the existing Custom OpenAI provider. The key is entered through the masked Settings field; configuration persists across app restarts. Parakeet Compact transcription stays local. Report instructions now explicitly preserve written requirements and keep unresolved source disagreements out of confirmed tasks. A native long-note rerun corrected the observed omitted requirement and false assignment, while a short control retained an explicitly resolved assignment. These single synthetic runs do not establish general factual accuracy. Translation caches include the report instructions in their identity so rule changes invalidate older reports. Afterword also requests `reasoning_effort: "none"` when the canonical Ollama `qwen3.5` or `qwen3.6` model families are selected, so those models do not wait for extended reasoning. Generated summaries still require review.

Local Gemma remains available as an alternative, with its existing enhancement reasoning profile unchanged. A September 9 comparison of sixteen synthetic cases rejected Qwen 9B MXFP8, Gemma 12B MLX with reasoning disabled, and reasoning-disabled Gemma E4B: each was faster but introduced additional factual or coverage failures. Gemma 12B with its default reasoning also exhausted the output limit on a tiny note. The downloaded 12B model is an evaluation artifact, not the recommended selection. These single runs are diagnostic evidence, not a general model ranking; full reports and the comparison decision are linked from `docs/wip/handoff-afterword-current-state.md`.

The Gateway preset now targets `openai/gpt-5.6-luna`. It reuses the Custom OpenAI transport with low reasoning for enhancement/source review and medium reasoning for streamed questions, retaining the 2,048-token question budget. Chat instructions distinguish final commitments from unresolved source disagreements, and current sources follow conversation history so earlier assistant answers remain subordinate to source evidence. The combined profile passed the observed disputed-assignment case and an explicit-correction/completed-task control; general accuracy and latency remain unbenchmarked. Switching from another custom endpoint clears its credential and sampling fields; the user enters a Gateway key in the masked settings field and saves. Configuration objects containing keys must not be logged. The connection check requires complete nonempty text, keeps its result visible, and avoids exposing provider response bodies in errors. Live Gateway validation is recorded in the current handoff.

Luna questions use [Gateway streaming](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/streaming), displaying text as it arrives through the existing chat channel. **Stop answer** cancels the request and labels retained text as incomplete. Hidden reasoning is not displayed, and partial answers are excluded from completed conversational context. Saved completed and stopped answers survive app restarts. Enhancement and source review still wait for a complete result. Streaming improves response visibility; it does not establish factual correctness.

Enhancement observers read immediately on entry and on the native `summary-completed` event, emitted only after successful result persistence. Five-second polling remains the fallback for older builds, missed events, and unavailable event listeners. In-flight reads are serialized, with an immediate follow-up read when completion arrives during a pending read. Native timing logs separate preparation, generation, and persistence; frontend timing records result-fetch time and elapsed time since the saved-result event. These timings do not measure the full editor paint or establish model speed. The event producer is active in dev build `20260909-afterword-events`. A synthetic native enhancement verified a two-millisecond result fetch and three milliseconds from the saved-result event to observation; this is not a general model-latency or editor-paint benchmark. Older binaries continue to use fallback polling.

Follow-ups reads checkbox blocks from original written notes. Completing or reopening an item updates the source through a compare-and-save operation; conflicting edits require a refresh. Open/Completed and folder filters apply to non-trashed notes, and source links preserve the return filters. This view does not infer new tasks from model-generated prose.

Quick-note text recognizes explicit Markdown task items such as `- [ ] Send results` and `- [x] Review captions` when saved or carried into a recording. Checked state is retained; quoted and fenced examples remain text. Existing saved paragraph blocks are not retroactively converted.

Live notes are stored locally under the temporary IndexedDB recording ID (`meeting-<timestamp>`). The shared stop handler saves them to SQLite under a stable persisted meeting ID (`meeting-recording-<source ID>` for new recordings; older meetings retain their UUIDs) before marking the recording saved. Interrupted recordings retain their draft for the existing recovery flow. Saved-note edits use the native notes API. Save retries reuse the source recording ID instead of creating another meeting. Failed audio recovery keeps its recovery entry and checkpoints for another attempt.

The recording workspace renders immediately without a page entrance animation, so WebKit animation failures cannot hide the recording controls. Recording-start URLs are consumed once per app-window session before capture is requested. Reloading or revisiting an already consumed URL does not restart recording; an explicit new start gets a newer token, including after a clock rollback. If the replay guard cannot save its state, capture is not requested. This guard complements the native active-recording check and does not replace it. Recording-state reads are serialized during startup and capture. Backend confirmation restores the recording lifecycle after reload or a missed start event; older reads cannot undo a newer Stop, pause, or save transition. A confirmed stopped backend clears capture flags while preserving transcript processing and saving.

The live and just-saved workspaces share the saved-meeting assistant dock beneath a centered editor. **Stop** remains in the sticky header while the document scrolls. **Transcript** opens all available passages in a drawer; closing it returns focus to its button. A short latest-passage preview provides live feedback. **Note actions** contains copy and clear. Assistant answers use snapshots of the original notes and transcript with inspectable source citations; **What did I miss?** retains its last-five-minute transcript scope.

Recording questions and answers now save locally with their cited source excerpts. Stopping or recovering a recording attaches that history in the same transaction as the meeting and transcript; answers finishing afterward use the saved meeting. Reopening shows the same conversation under **Show conversation**. A new recording starts its own conversation without clearing the previous one. Navigation and Quit preserve visible partial answers with an incomplete notice; a crash can retain only the last checkpoint. A failed history load disables sending and offers **Retry** rather than replacing unread data. Deleting a recovery entry removes its unattached chat; deleting a saved meeting removes its chat. Small recording-to-meeting identity markers remain without conversation text to prevent late writes from recreating deleted content.

**New note** opens the local scratchpad without starting audio. When unfinished work exists, Home instead shows **Resume draft** and a title/preview above the library; an empty scratchpad has no draft card. A title-only draft remains resumable, and a pending save is labeled **Finish saving your draft**. **Copy** is available when the draft has text. Write some text and choose **Save note** to add it to the library and open the saved-note editor. The note and its optional folder membership save together. If saving fails, the submission stays locally available through app restarts; choose **Retry save** to finish before editing or recording. Retries do not duplicate the note or overwrite later library edits. After success, the scratchpad clears.

**Start recording** explicitly starts capture, carrying draft notes into the session. **New recording** starts a separate meeting carrying the current notes; it does not append to the previous transcript. Original notes and titles save automatically both after stopping and after reopening, with visible save/retry status. Enhanced-note editing retains its explicit save action. **Enhance notes** can use notes alone when no transcript exists.

For HTTP-backed enhancement, explicit incomplete responses (including output limits and filtering) fail instead of replacing the previous summary. Empty or reasoning-only note output is also rejected. A failed transcript part stops the report; it is not silently skipped. Older compatible servers that omit completion metadata remain supported, so this check cannot prove completeness when the server supplies no termination signal. These checks follow [OpenAI completion signals](https://developers.openai.com/api/reference/resources/chat) and [Claude stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons); they do not establish factual accuracy.

If the final enhancement write fails, the app attempts to mark the job failed and recover the incumbent result through the existing backup path. Generated titles are applied only after the result saves. Editing rejects missing enhancements and active jobs instead of reporting a successful save. Recovery still requires writable local storage; a complete storage outage can also prevent the failure state from being recorded.

In a saved note, press `⌘F` (`Ctrl+F` on Windows) or choose **Meeting actions → Find in note**. Search applies to the visible **My notes** or **Enhanced** document, including phrases split across inline formatting. Use **Next match** / **Previous match**, `Enter` / `Shift+Enter`, or `⌘G` / `⌘Shift+G` to move between matches. The bar stays available while the note scrolls; `Escape` closes it and returns focus. Switching views searches the new view with the same query. Searches are literal and case-insensitive, show **No matches** when no text matches, and highlight up to 1,000 matches; a `+` in the count means to narrow the query. Highlighting does not change saved note content. This saved-note search is separate from transcript search and library search.

In the saved-note editor, choose **Meeting actions → Previous enhancement** to preview the version kept before the last successful replacement. **Restore this version** replaces the enhanced document and keeps the displaced version available in the same dialog, so the restore can be undone. Original written notes, transcripts, and the meeting title are unchanged. Current enhanced edits save before the preview opens; restoration refuses stale versions or an active enhancement. One previous version is retained locally across restarts, including edits saved before regeneration. Failed or cancelled enhancement does not replace it. This starts with replacements made after installing the feature; it cannot recover versions already discarded by earlier builds and is not a full edit history.

Meeting questions and follow-up recipes use written notes and available transcript text as separate sources. If both are empty, the app explains what to add instead of silently ignoring the question. Home shows stored meeting dates; **All notes** opens the full collection. Search finds titles, original written notes, and transcripts, with source excerpts and pagination. Opening a match shows its current source passage; **Back to search** retains the query and any selected folder. The list mode, folder, and submitted search are represented in the URL.

## Ask across recent meetings

In **Ask your notes**, choose **Sources → Recent meetings** and a date range for broad questions such as “What follow-ups were agreed?” This reviews the five newest meetings with saved original notes or transcript text, without requiring matching keywords. Each answer shows the number reviewed, the number available in the range, and source links. Generated enhancements are not evidence. Empty notes and Trash are excluded.

Every saved source segment from those meetings is included, or the request fails visibly if the combined source text and labels exceed the 120 KB request bound (or 1,000 source segments). No transcript ending is silently omitted. Choose a shorter range, **Keyword matches**, or an individual meeting when the recent set is too large. The scope and date range save with the conversation. This is a bounded source review, not a task tracker or proof that every stated task remains open; model accuracy still needs checking against citations.

## Organize saved notes

1. Choose **New folder** on Home or in the expanded sidebar, enter a name, and choose **Create folder**. To rename it, open the folder and choose **Rename folder**.
2. Open a saved note’s actions and choose **Organize note**. Check or uncheck folders; each change saves automatically. **Create and add** creates a folder and assigns the note together. Choose **Done** when finished.
3. Open a folder from the sidebar or **Filter by folder** on Home. Search is limited to that folder. **All notes** returns to the full collection, and **Back to folder** returns from a note to its folder.

A note can belong to multiple folders. Membership is stored in SQLite separately from recording paths, so organizing notes does not move files or change their content. Moving a note to Trash retains its memberships; permanent deletion removes them. Folder names and memberships survive app restarts. Folder deletion, nesting, and sharing are not implemented.

**New note** and **Start recording** inside a folder carry that folder into an empty draft. Reopening an existing draft preserves its original folder, including an unfiled draft. The editor shows the folder and offers **Back to folder**. **Save note** assigns the standalone note to that folder. Folder assignment is also confirmed during recording save or interrupted-session recovery before its recovery data is discarded. A failed assignment can be retried against the same saved meeting without creating another copy.

## Trash and restore

1. On Home, open a note's actions and choose **Move to Trash**. It disappears from the library, folder counts, and new source searches. Existing saved chat answers remain available while the note is in Trash.
2. Choose **Trash** on Home, then **Restore** beside the note to return it to its original folders. Written notes, transcripts, enhancements, previous enhancement, and recording paths are retained. Trash survives app restarts and has no automatic expiry.
3. To remove the saved note irreversibly, choose **Delete permanently** inside Trash and confirm. This removes its database records and saved library answers that used it. Recording files on disk are kept. Choose **Cancel** to keep the note recoverable.

Trash shows 50 notes per page with **Previous** and **Next** controls. Failed reads and mutations can be retried; a failed permanent deletion rolls back its database transaction. Moving or permanently deleting a note is refused while its enhancement job is running. This feature cannot recover notes permanently deleted by earlier builds.

## Export Markdown to a folder

1. Open a saved note and choose **Meeting actions → Export Markdown**.
2. The current user's Documents folder is the default. Choose **Change folder** to select an existing custom destination, such as a dedicated folder inside an Obsidian vault. The app remembers that custom folder on this Mac.
3. Choose **Export Markdown**. Pending title, written-note, and enhancement edits must save successfully first. The completion message shows the created file's full path.

Each UTF-8 `.md` file contains YAML metadata (meeting ID, title, creation/export timestamps, and transcript segment count), enhanced notes, original written notes, and every saved transcript segment in recording order. Recording-relative timestamps use `HH:MM:SS`; older segments retain their saved timestamp. Missing sources are explicitly labeled. No model is called during export.

Exports are manual snapshots, not automatic sync. A dated filename with a unique suffix prevents replacing existing files or edits made in Obsidian. The complete file is written before it becomes visible with its final `.md` name. Export again after changing a note. If the folder is disconnected or unwritable, choose another folder and retry. Enhancement in progress and notes in Trash cannot be exported. An older enhancement without a saved Markdown representation reports an error instead of silently omitting its content.

## Local enhancement context limits

Local enhancement budgets the complete request, including template instructions, written notes, chat overhead, and answer space. Ollama reserves one quarter of the reported context for the answer, capped at 4,096 tokens, unless an explicit output limit is supplied. Built-in AI reserves its existing 4,096-token output limit. Long transcripts are extracted in bounded chunks; extracted notes are merged in bounded batches only when needed for the final report. A merge that does not shrink stops instead of repeating indefinitely.

Written notes are kept intact in the final request. If they and the template leave too little room, or a translation exceeds the budget, enhancement reports an error and preserves the saved result. Truncated model output is also rejected. A small context can therefore fail clearly rather than produce a partial enhancement.

Token counts remain estimates, not model-tokenizer measurements. Non-ASCII text is budgeted conservatively using UTF-8 bytes. Explicit `num_ctx` values reported by Ollama take precedence over a larger architectural maximum; without an explicit setting, the reported maximum does not prove the server's allocated context. See [Ollama context configuration](https://docs.ollama.com/context-length). These limits protect request construction; they do not establish factual completeness of generated notes.

## Review written-note coverage

1. Open a saved note with written notes and an enhancement. Choose **Meeting actions → Review written-note coverage**.
2. Compare the suggested passages with the enhancement. Each quoted passage is copied from your original written notes. Expand **Written notes used for this review** to inspect the complete snapshot. The review includes metadata; you decide what belongs in the enhancement.
3. Choose **Close** to return to the editor, or **Cancel review** while the model is working. **Review again** reads the current editor contents, including unsaved enhancement edits. A failed review offers **Try again**.

The action uses the configured enhancement model but sends only the written-note and enhancement snapshots, without transcript or conversation history. It does not edit either document or save a review history. Closing or changing meetings cancels the request and discards late responses. The model must account for every nonempty written line exactly once; a claim of coverage requires exact quotes from the enhancement. Invalid or incomplete reviews are rejected, and local requests use the same estimated context budget as enhancement. Inputs above 100 passages or 120,000 combined UTF-8 bytes are refused without truncation.

Coverage suggestions are not factual verification. A model can misread intent, mistake a related statement for coverage, or flag details that you intentionally left out. An empty result does not establish completeness. Use the original sources to resolve disputed owners or dates; this action does not reconcile them automatically.

## Validation before promotion

For recent-meeting task classification, run `node frontend/scripts/eval-recent-tasks.cjs` from the repository root. Ten synthetic controls cover requirements, declined requests, completed work, conflicting and corrected assignments, missing owners, explicit availability checks, and conditional commitments. The runner uses the current recent-source formatter and native streaming chat profile without reading saved meetings or changing model selection. `--categorized` compares a question that requests separate categories; it does not change the app's prompt. Set `AFTERWORD_EVAL_MODEL` and `AFTERWORD_EVAL_REPORT` for comparisons. Exit zero proves successful requests only: manually compare every answer with the fixture's expected meaning, including omitted commitments and unresolved conflicts. Do not count a valid citation as proof that its task classification is correct.

For synthetic summary-quality evaluation, run `node frontend/scripts/eval-summary-quality.cjs` from the repository root. It prepares written-note context with the actual frontend helper, then calls the native summary pipeline through local Ollama. The default model is `gemma4:e4b-mlx`, with runtime context sizing; this does not change the app's selection. Set `AFTERWORD_EVAL_MODEL`, `AFTERWORD_EVAL_CASE`, or `AFTERWORD_EVAL_CONTEXT` to compare models, select a fixture, or force a token threshold. `AFTERWORD_EVAL_REPORT` overrides the default `/private/tmp/afterword-summary-quality.json`. Reports include the prepared source context, output, timing, and failed checks. The runner intentionally exits nonzero for known factual failures; review the prose even when phrase checks pass. Invoke this script rather than the underlying ignored Cargo test, which requires the script's prepared context file.

When scoring rules change, rescore saved synthetic outputs without another model call. Set `AFTERWORD_RESCORE_INPUT` to the original report and `AFTERWORD_RESCORE_OUTPUT` to a different output path, then run `cargo test -p meetily --features afterword --lib summary::quality_evals::rescore_saved_summary_quality -- --exact --ignored --nocapture`. The new report retains the original failures and timing beside updated checks; a successful command means rescoring completed, not that every case passed. Fixture `allowed_negations` entries are exact, manually reviewed exceptions to forbidden-phrase checks. They do not provide general semantic negation detection, and a separate contradictory assertion still fails.

From `frontend`:

```sh
npm run typecheck
npm run test:recording
npm run test:markdown
node --test tests/lib/onboarding-summary-model.test.mjs
NEXT_PUBLIC_FLAVOR=afterword npm run build
```

From the repository root:

```sh
cargo check --offline -p meetily --features afterword
cargo test --offline -p meetily --lib --features afterword quality_
git diff --check
```

Use a packaged tester for macOS audio validation. The release bundle can be built with `frontend/build-afterword.sh`; when only an app is needed, pass `--bundles app` to the Tauri build command. Do not launch a dev instance and packaged tester with the same bundle ID simultaneously. To zip and send that `.app`, follow [Sharing Afterword](afterword-sharing.md).

Verify **New note** opens a draft without recording, **Start recording** begins capture, synthetic speech produces a transcript, notes/title/transcript survive leaving the workspace, **Stop** saves once, and reopening shows the saved content. Edit the saved note and reopen again. Repeat a recording to catch stale session state. Check the visible build badge against the intended build.
