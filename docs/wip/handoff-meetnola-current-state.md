# Meetnola Current State Handoff

Last updated: 2026-09-09

Current checkout: local `main`. Continue work directly on `main`; branches and worktrees require an explicit request. Nothing was pushed. Earlier branch references below describe historical validation state.

September 9 checkpoint: committing the source-review controls, selected-statement checks and synthetic evaluations, note-loading readiness/retry safeguards, and enhancement source preparation described below. Earlier uncommitted statements describe their original validation passes.

Enhancement source fix: the shared summary hook now includes original written notes for both generation and regeneration when a transcript exists. Notes-only meetings carry the notes once in the main input instead of duplicating them as additional context. Both pages use this shared preparation. TypeScript, 112 workflow tests, production static export, and diff checks passed. Tests cover mixed, notes-only, transcript-only, and edited-between-generations inputs. Native **Enhance again** on the synthetic saved-note review included details unique to the written notes and preserved the transcript requirement without inventing an assignment; Home/reopen retained the result. The legacy regeneration entry point was verified by request-level tests. Model settings and the native binary remain unchanged; broad model accuracy remains unproven.

Latest readiness fix: a failed written-note load now exposes Retry in the saved editor, source sheet, meeting chat, and post-recording view. Readiness belongs to the current meeting; late reads cannot supply the next meeting's state. Duplicate retries are suppressed, and retry cannot replace successfully loaded or locally edited notes. Chat, recipes, selected-claim checks, and enhancement wait for notes to load; a successful empty-note read still permits transcript-only work. The source loader independently rejects unavailable notes before fetching transcripts. Automatic enhancement now waits for the original notes and includes their existing enhancement prompt.

Verification: TypeScript, 109 workflow tests, production static export, and diff checks passed. Regressions cover failed/pending reads, duplicate retry, preserved edits, navigation, loaded-empty notes, and stopping chat/enhancement before requests. A fault-injected browser fixture used the real note-loading/chat hooks and source sheet with mocked storage/model calls: failure kept Send disabled and preserved the draft with zero calls; retry exposed the recovered note and the next request included it. The 390×844 recovery view had no horizontal overflow. Native Gemma answered a synthetic written-note question and opened the correct saved S1 excerpt. No native database fault or live recording was induced; the post-recording controls were checked in source/build, not through a new recording. The preview was stopped. All current changes remain uncommitted on `main`; native dev and model selection are unchanged.

Latest source-review UI: **Review sources** in saved-meeting chat opens the existing transcript sheet with **Written notes** and **Transcript** tabs. It exposes current originals independently of the model's citation choices and labels them separately from saved answer excerpts. The original Transcript shortcut still opens transcript search directly. Search survives tab switches; text with long unbroken words wraps inside the panel. No source snapshots or model settings were changed.

Behavior decisions: improve access to uncited original notes; preserve saved citation excerpts and cross-meeting chat scope; preserve transcript search, copy, refresh, and pagination; improve modal reliability with immediate opening/dismissal and focus returning to the actual trigger. Native WebKit left the sheet invisible while it held keyboard focus; removing the shared sheet animations fixed the observed failure. Source-tab selection also updates immediately. This shared primitive change also applies to the post-recording quick-note transcript sheet, which was not exercised during a live recording in this pass.

Verification: native checks on the synthetic saved-note review covered both source tabs, arrow-key navigation, Escape/trigger focus, direct Transcript/search focus, retained search, and saved cross-meeting citations/navigation. An isolated browser fixture used the production components and copied current sheet markup with synthetic data and the app font. At 390×844 and 960×800 the source sheet had zero horizontal overflow, including long unbroken text; 320×740 chat controls also fit. Search found segment 121 beyond the initial 100, pagination completed, and closing preserved the unsent draft. TypeScript, 105 workflow tests, production static export, and diff checks passed. The temporary preview was stopped; native dev remains running. These changes remain uncommitted on `main`. Model judgments under conflicting sources remain an unresolved accuracy issue.

Current continuation: enhanced summaries now offer **Check selected text**, also available with Command/Ctrl+Shift+Enter. It sends the selected statement to the existing saved-meeting assistant using only original written notes and transcript as evidence. The summary is not evidence, the unsent chat draft is preserved, and checks use the existing model, cancellation, citation snapshots, and conversation persistence. Selections outside the summary, empty selections, and selections over 1,200 characters cannot be submitted. These frontend changes and this record remain uncommitted on `main` after checkpoint `df696f1`.

Validation: TypeScript, all 104 workflow tests, and the twelve-page production static export passed. Native hot-reload verification on build `20260909-0809-summary-requirements` used only **Meetnola saved-note review**. Button and keyboard checks supported the real title-preservation requirement; a temporary invented Morgan/Friday assignment was flagged as unsupported. The temporary sentence was removed and the restored summary verified after Home/reopen. All three new checks persisted, and the restored citation opened the exact original transcript excerpt at 0:45. This is an on-demand model-assisted check, not an automatic factual guarantee or a comparative accuracy benchmark. The development frontend remains running; no native binary, model preference, or standalone tester was changed.

Harder claim evaluation: added eight synthetic cases covering changed owners, unconfirmed offers, compound claims, conflicting notes/transcript, withdrawn approval, negative wording, unresolved ownership, and instructions inside a selected quote. Both prompt experiments were rejected: one mislabeled prior approval as a proposal; the verdict-based version called an unconfirmed commitment partly supported. The original prompt is retained. Gemma caught explicit reassignments/withdrawals but still resolved conflicting written notes and transcript too confidently, omitting the notes conflict entirely in its repeat. Qwen 4B/9B did not resolve that weakness; 9B additionally named the wrong people to contact in the ownership-disagreement case. No model switch was made.

The repeat's seven subsequent Gemma calls completed in 0.15–0.41 seconds, versus 0.81–3.04 seconds for Qwen 4B and 1.53–3.98 seconds for Qwen 9B. First calls took 1.50, 3.83, and 7.55 seconds respectively. These sequential, short synthetic runs have different answer lengths and warm/cache effects; they do not establish representative long-meeting performance. Full responses and timing are in `/private/tmp/meetnola-claim-{baseline,candidate,verdicts,gemma-repeat,qwen4b,qwen9b}.json`. The evaluation additions, source checker, and handoff remain uncommitted on `main`. Refreshed TypeScript, 104 workflow tests, and 100 native summary regressions passed (five opt-in live tests excluded). Accuracy under unresolved source conflict remains open.

Commit checkpoint (September 9): the accumulated work is committed on main: `46ccb28` upgrades Next.js/React, `fc4850f` adds persistent conversations/search and the note-workspace fixes, and `344e270` preserves summary requirements and expands quality checks. Earlier uncommitted-status statements below describe their original validation passes. The pre-commit refresh passed TypeScript, 102 workflow tests, three Markdown tests, and eight native Meetnola regressions (one live-model test ignored); native summary/build and visual evidence remain recorded below. Nothing was pushed.

Post-commit investigation: confirmed that section instructions reach the model. Tested a Key Decisions clarification that explicitly retained approvals mentioned in Summary and excluded completed work/current status. The committed baseline misplaced the completed audit; its other flagged result was a valid paraphrase of intact source data. The candidate passed all thirteen cases once, but its repeat again put the completed audit in Key Decisions. The candidate was rejected and the template restored exactly to `344e270`; no native app or bundled template was changed. The experimental `20260909-0822-decision-placement` build was not activated. Do not copy that build into the app; rebuild from current source before any future activation. Evidence: `/private/tmp/meetnola-decision-baseline.json`, `/private/tmp/meetnola-decision-candidate.json`, and `/private/tmp/meetnola-decision-repeat.json`. Repeated template wording alone has not established reliable decision classification. The next pass should evaluate source-linked verification of extracted decisions rather than treating another single green phrase-check run as proof of accuracy.

Latest accuracy pass (September 9): expanded the local-model fixtures from nine to thirteen with varied conversations covering two owners/two deadlines, completed work versus new follow-up, separate approved/pending expenses, and an interrupted handoff. Checks now bind task, owner, and deadline within one action item instead of accepting their presence anywhere in the action section. Regression tests reject swapped owners/dates and an approval mentioned only in the overview while Key Decisions says None noted. Lexical checks accept faithful paraphrases; an observer's stated intention was not treated as an invented task merely because the observer owned neither main deliverable.

Baseline Gemma omitted the title-preservation requirement once and misplaced completed/pending status under Key Decisions. A template wording experiment did not consistently fix classification and was reverted. The retained production change adds one instruction to preserve stated requirements even when no follow-up work was assigned. That requirement survived both subsequent full-suite runs and the native saved-note check. Reports are `/private/tmp/meetnola-varied-baseline.json`, `/private/tmp/meetnola-varied-candidate.json`, `/private/tmp/meetnola-varied-requirements.json`, and `/private/tmp/meetnola-varied-final.json`. The final run passed the then-current thirteen-case checks, but manual review found the encryption approval absent from Key Decisions despite appearing in the overview. The new decision-placement regression was added afterward, so the final report is not a pass under today's stricter checks. Another run put the completed audit under Key Decisions. Classification remains variable and is the next quality issue to address; these short synthetic cases do not establish representative meeting accuracy or superiority to Granola.

Activation: native dev build `20260909-0809-summary-requirements` is installed, ad-hoc signed, and strictly verified. Binary and unchanged standard-template hashes match source/build artifacts. Native generation on the existing synthetic saved-note review preserved the stated requirement without inventing a task; Home/reopen retained the summary and custom title. Original notes, transcript, and model settings were unchanged. The standalone tester was not changed. All 100 deterministic summary regressions and diff checks pass; the new runtime build passed. No frontend code changed in this pass. All work remains uncommitted on main, with the existing Next.js dev server running and nothing pushed.

Previous interaction pass (September 9): fixed the stuck dropdowns by removing entrance/exit animation classes from the shared Radix dropdown content and subcontent. Radix otherwise retains its selection, keyboard, focus, portal, and outside-dismissal behavior. Native checks now pass for note-view selection, Home/Return keyboard selection, Escape, outside click, template selection, and Escape/Return reopening from the restored trigger focus. A narrower native window remained usable. This verifies the fix for the reproduced menus; other animated dialogs/sheets were not audited in this pass.

Enhancement feedback now uses inline progress instead of an independent timed start toast. Completion, cancellation, and errors share a per-meeting notification ID, and starting a new generation dismisses its earlier feedback. Stop waits for the startup acknowledgment, keeps polling until a terminal backend result, and reports cancellation failure without falsely resetting the job to idle. Five regressions cover cancellation, completion races, request failure, delayed startup, and startup failure. Native local-Gemma generation completed, and a subsequent immediate Stop showed confirmed cancellation with the previous summary intact. Original notes, transcript, title, model, and template selection were preserved; only the synthetic enhanced summary was regenerated. Sonner's existing hidden-document/hover timer behavior is unchanged; this pass fixes conflicting generation messages, not every notification timing behavior.

Validation: 102 workflow tests, three Markdown tests, TypeScript, the production static export, and diff checks passed. Changes are active through the existing Next.js development server and remain uncommitted on main. The standalone tester is unchanged. Next broaden summary evaluations beyond the repetitive synthetic fixture; general factual accuracy and superiority to Granola remain unproven.

Previous upgrade pass (September 9): upgraded the frontend from installed Next.js 14.2.35 to 16.3.4 and React 18 to 19.2.8. Retained Webpack explicitly for the existing BlockNote/ProseMirror aliases and Tauri static export. Migrated async route params, React ref types, the removed lint/export commands, and ESLint flat configuration. Removed unused Remirror dependencies that constrained React compatibility. The lockfile and five build workflows now use pnpm 9.15.9; workflows use Node 22, with Node 20.9 as the minimum. Next.js generated frontend AGENTS.md and CLAUDE.md guidance files.

Upgrade validation: frozen lockfile installation, TypeScript, all 97 workflow tests, three Markdown tests, production build with all 12 static pages, and diff checks passed. Native checks verified a clean relaunch, the saved synthetic note, editor input and autosave, restoration of the original synthetic summary after testing, saved chat citations, and the library conversation with its draft and Last 30 days scope intact. The first development load hit a chunk timeout; the asset returned HTTP 200, webview Reload recovered, and subsequent full relaunch loaded normally. The pre-existing native note-picker dismissal issue reproduced and required graceful Quit/reopen. Lint now runs but reports 273 errors and 161 warnings across the codebase under the upgraded rules; this is not a clean lint baseline. ESLint 9 remains because the React plugin does not yet declare ESLint 10 compatibility.

The upgraded frontend remains running on port 3118 (session 32111; log `/private/tmp/meetnola-next-dev.log`) against the existing native development build `20260909-0734-summary-fidelity`. No native binary or standalone tester was rebuilt for this frontend upgrade. All prior work and this upgrade remain uncommitted on `main`, with nothing pushed. Resume popup/notification lifecycle fixes and broader summary evaluation after this dependency pass.

Current pass (September 9, 07:39 PDT): improved summary fidelity and verified build `20260909-0734-summary-fidelity` in the native dev app. The pipeline now sends extracted transcript parts directly to final formatting when they fit after accounting for the template and typed-note overhead, avoiding an unnecessary intermediate model rewrite. Oversized extracted notes retain the existing combine path. Final instructions preserve later explicit owner/deadline corrections; the standard template places pending proposals and uncommitted offers in Discussion Highlights. Other templates retain their own section structure.

Evidence: the selected `gemma4:e4b-mlx` passed all nine existing short cases before and after the changes. The new 14,089-character synthetic fixture separates an early Noah/Monday assignment from its later cancellation and Liam/Tuesday replacement. It deliberately uses repeated review material and a 4,000-token threshold to exercise two transcript parts; it is not a representative one-hour recording or a benchmark of the app's dynamically selected context size. Baseline generation omitted the final assignment in one run (35.6 seconds); a traced rerun retained it, establishing variability rather than a deterministic failure at one stage. The final version passed two repeats at 26.7 and 28.1 seconds, retaining Liam/Tuesday, intact records, the internal pilot, and the pending budget outside Key Decisions. Section checks now catch budget placement, while manual review still found other scope statements presented as decisions in one repeat. These checks do not establish general factual accuracy or superiority to Granola. Reports are `/private/tmp/meetnola-accepted-short.json`, `/private/tmp/meetnola-accepted-long-1.json`, and `/private/tmp/meetnola-accepted-long-2.json`; the opt-in evaluations and deterministic regression are in `frontend/src-tauri/src/summary/quality_evals.rs`.

Activation corrected an earlier evidence gap: the development app's bundled `standard_meeting.json` was still the old table-and-timestamps template, despite prior source updates. There was no custom standard template override. Both the tested binary and standard template were copied into the existing dev bundle, matched against source by SHA-256, and the bundle was ad-hoc signed and strictly verified. Future manual activations must verify changed bundled resources as well as the binary. The standalone tester was not changed.

Native checks confirmed build `20260909-0734-summary-fidelity`, idle recording state, local Gemma enhancement of the existing synthetic saved-note review, no invented task, preserved custom title, and the regenerated summary after Home/reopen. The original written note and transcript were not edited. Visual checking found the document remained transparent while its entrance animation failed to complete; replacing the outer motion wrapper with a normal div made the note immediately visible and still visible after navigation. The final source passes 98 summary regressions, 97 frontend workflow tests, TypeScript, native build/signature checks, and diff checks. The frontend-only animation removal was hot reloaded after that native build. No new production frontend build was run for that wrapper removal.

Remaining UI observations: the native template popup resisted dismissal through Computer Use until graceful Quit/reopen, and generation/success notifications lingered together during this check. Do not infer either root cause from the automation behavior alone. Next inspect notification lifecycle and popup/focus behavior, then broaden evaluations beyond repetitive synthetic input. All current work remains uncommitted on `main`; nothing was pushed. The broader Granola goal remains active.

Previous conversation pass: cross-meeting conversations now persist in SQLite. **Conversations** reopens history, **New chat** starts a separate conversation, and **Archive / Restore** keeps old chats recoverable. Drafts and date ranges belong to their conversation and save through the existing quit-flush mechanism. Titles derive from the first question or unsent draft. The picker supports Recent/Archived views and pagination. Loading gates edits; failed saves and loads retain data and expose Retry. Saved-meeting chat retains its existing behavior through the shared persistence hook.

Source lifecycle: only cited excerpt text is stored, together with IDs for all consulted meetings. Deleting a source meeting removes affected generated answers and their copied excerpts from active and archived library conversations; user questions and unrelated answers remain. Late saves recheck source existence and cannot restore removed text. Archived conversations reject late message/draft updates. These controls operate in the existing SQLite database; enhancement still uses the selected provider, with no model-setting change.

Verification: 96 frontend workflow tests, three Markdown tests, TypeScript, nine native Meetnola tests, and final frontend/native builds passed. Native coverage includes an actual temporary SQLite file closed and reopened with the conversation, unsent draft, and date filter intact; source deletion, late writes, independent conversations, and archive protection also passed. Browser checks used the actual page/hooks/components with a synthetic persistence/model backend: separate conversations, navigation and reload recovery, preserved draft/date scope, restored citations, archive/read-only/restore, and the history picker. At 390×844 and 960×800 there was zero document horizontal overflow. Resizing a restored draft from desktop to narrow now changes textarea height from 36px to 76px, matching its scrollHeight; its bottom remained at 815px in the narrow viewport. This fixes clipping caused by sizing only on input changes. The simplified preview shell and synthetic backend do not establish native app activation or real multi-window behavior.

Previous cross-meeting pass: **Ask your notes** adds cross-meeting questions through Home and the sidebar. A dedicated, responsive chat page reuses the streaming assistant, Stop, citations, Copy, focus restoration, and confirmation before Clear. That first version retained conversations only during the session; the persistence pass above supersedes this limitation. Durable saved-meeting conversations remain unchanged. Errors offer Edit question, and the status announcement distinguishes failure from a completed answer.

Retrieval uses the existing SQLite database and selected enhancement client. The new [FTS5](https://www.sqlite.org/fts5.html) index covers titles, original written notes, and transcripts, with transactional maintenance for edits, moves, renames, and deletion. It does not index generated summaries or chat answers as evidence. Date filters offer All time and rolling 7/30/90-day ranges. Query words are quoted and bounded; short reference questions reuse the previous substantive topic. Retrieval ranks across matches, limits each meeting to four excerpts and the answer context to sixteen excerpts, and caps excerpt length. Each answer discloses search words, date range, and source coverage. Citations retain the exact excerpt, meeting title/date, recording time where available, and an Open meeting link. This is keyword retrieval, not exhaustive semantic search; relevant material outside the excerpts can be missed.

Verification: 91 frontend workflow tests, three Markdown tests, TypeScript, six native Meetnola tests, final isolated production frontend build, and native development build passed. A separately invoked test through the actual local `gemma4:e4b-mlx` client retrieved two synthetic indexed meetings and correctly answered that Mira owns the launch while the budget is proposed, not approved, citing both sources. This single short case does not establish general factual accuracy or large-library performance. SQLite tests cover backfill, date filtering, Unicode, edits/moves/rename/deletion, literal FTS operators, and diversity when one meeting has 200 matching segments. No live meeting database was opened from the host.

The isolated browser preview uses the real page/hooks/components with a simplified shell and simulated retrieval/streaming. At 390×844 and 960×800 it had zero document horizontal overflow; the composer bottom was 815px and 771px respectively. Verified navigation retention, source excerpt and meeting-link destination, no-match feedback, Edit question, date selection and per-answer coverage, Clear confirmation/Keep, and Jump to latest with focus in the conversation. Visual checks caught and fixed a date-only import shifting to the previous day. The preview is not evidence of the native IPC path or live app layout.

Native activation and verification completed September 9: build `20260909-0053-chat-history` is installed in `/private/tmp/meetnola Dev.app`, ad-hoc signed and strictly verified. The stopped development frontend was restarted on port 3118. An initial stale Next.js chunk timeout cleared through the native webview's Reload menu after verifying the asset was available; the subsequent full app restart loaded normally. Native checks used the existing synthetic **Meetnola saved-note review** and two synthetic library conversations. They verified a local streamed answer, the exact 0:45 transcript and original-note excerpts, Open meeting navigation, the existing per-meeting history, a follow-up using restored context, independent chats, retained multiline drafts/date ranges, and Archive/read-only/Restore. Command-Q fully exited the native process; after relaunch, both conversations, the first chat's Last 30 days scope and draft, and clickable citations were restored. No meeting notes, transcripts, or model preferences changed. The standalone tester remains unchanged.

Native checking exposed two issues missed by the simplified browser shell. Gemma emitted grouped citations such as `[S1, S2]`, which were plain text and therefore lost their excerpt snapshots on save. New answers now normalize known grouped IDs into individual links before persistence; the regression checks restored excerpts and leaves code, existing links, and unknown-only groups intact. The first synthetic answer generated before this fix still has plain markers and no saved excerpt; it was not rewritten using current source data. Subsequent grouped citations and their original excerpts survived full app restart. Also, the Ask page now uses the existing saved-note page's fixed viewport height: opening a long excerpt scrolls the conversation without pushing the composer below the native window. Wider and narrower native visual checks confirmed the draft and Send button remain visible. All 97 frontend workflow tests, TypeScript, and diff checks passed after these fixes; the nine native tests and final frontend/native builds above preceded these frontend-only follow-ups.

All four current batches and these native-verification fixes remain uncommitted on `main`, with nothing pushed. The development frontend remains running on port 3118. The broader Granola goal remains open: next prioritize harder factual-quality and long-meeting evaluations before adding more surface features. Calendar integration, shared spaces, folders, and multiple conversations within a single saved meeting remain separate gaps; no comparative accuracy or long-meeting performance claim has been established.

Previous persistence pass: saved-meeting conversations now persist in the existing SQLite database, including the original source excerpts actually cited by each answer. Loading gates new questions and ignores stale meeting results. Complete exchanges restore the last six turns of follow-up context; interrupted or failed answers do not. Writes use the existing ordered quit-flush queue, persist questions and completed answers rather than every streamed token, and retain visible partials on navigation or graceful Quit. Failed saves expose Retry. Clear requires confirmation; deleting a meeting cascades to its conversation, and late saves cannot recreate it. The per-meeting storage limit is 16 MB and fails visibly without truncating history. Live/quick-note chat remains session-scoped.

Previous native build: `20260908-2358-saved-chat` in `/private/tmp/meetnola Dev.app`, signed and verified, with frontend hot reload on port 3118. Native checks on **Meetnola saved-note review** verified an answer surviving Home/reopen, a follow-up using restored context, full Command-Q exit/relaunch, both restored exchanges, and the exact original 0:45 citation excerpt. The Clear dialog's Keep action preserved history. No meeting notes, transcripts, or model preferences changed; only this synthetic conversation was created. The broader Granola goal remains open.

Validation: 87 frontend workflow tests, TypeScript, a native persistence/isolation/deletion test, native build and signing, and isolated production frontend build. Coverage includes malformed-history refusal, load failure/retry, stale reads, storage minimization, incomplete-answer labeling, restored follow-ups, navigation/Quit checkpoints, and failed-save retry. Earlier design work's three Markdown tests also passed. Both the visual pass and this persistence pass remain uncommitted on `main`; nothing was pushed.

September 8 design pass: compared the running Granola Home, expanded navigation, saved note, and enhanced-note/template menu with Meetnola. Granola's document typography, compact note controls, right-aligned meeting times, and small bottom composer informed a targeted update on `main`. It uses the existing components and local model services; that visual pass changed no native code, model selection, or meeting content.

| Workflow | Decision and result |
| --- | --- |
| Home browsing and title search | Improve: serif page title, Recent/All notes controls, instant case-insensitive title filtering, clear/empty-result recovery, quieter search field, right-aligned times. Preserve date grouping, eight-item recent view, URL searches on Enter, draft, recovery, import, and row actions. |
| Saved-note reading and editing | Improve: compact My notes/Enhanced radio menu, serif document title, quiet regeneration control, less metadata and no header divider. Preserve both editors, autosave/retry, explicit Save in Meeting actions, model/template controls, and transcript access. Reserve scrollbar space so chat expansion does not shift document alignment. |
| Meeting assistant | Improve: slim idle composer, recipe menu and idle shortcut, growing multiline input, Enter/Shift+Enter and IME handling, answer copying, and follow-latest scrolling that pauses while reading older text. Preserve Stop, clear, complete source snapshots, exact citations, incomplete warnings, and six-exchange model history. Copy retains incomplete warnings; copy controls are hidden on the actively streaming answer. Reopening retains the current conversation and focuses the input. |

Verification: 81 frontend workflow tests, three Markdown tests, and TypeScript passed. Native checks on the synthetic saved-note review covered immediate title filtering, original/enhanced selection, multiline entry, a correct local answer with its 0:45 source excerpt, Copy feedback, Escape focus restoration, recipe-menu access, and conversation collapse/reopen. Wide and narrow native windows remained usable. An isolated browser fixture using the real Home and assistant components passed at 390×844 and 960×800 with zero document horizontal overflow; at 390px the input grew from 36px to 56px for two lines. With multiple long synthetic answers, a new update preserved scrollTop at 0 while reading earlier text; Jump to latest reached a zero bottom gap and focused the conversation. This fixture uses synthetic state and simulated answer updates, not the native backend or a model performance benchmark. Native screenshot/control interruption was resolved by opening the existing dev bundle through Finder. The running native build remains `20260908-2320-streaming-chat`, with these frontend changes active through hot reload.

The isolated production frontend build also passed on the final source; the existing Google Font fetch required network access. The synthetic browser preview and its development server were temporary verification tools, separate from the running native app.

Intentional differences and remaining work: retain the uniform white shell and local MLX/Parakeet providers. Calendar sync, shared spaces, folders, and multiple chat threads within a single saved meeting remain unimplemented. Cross-meeting questions and durable conversation history are implemented; native activation and verification are pending above. Per-meeting conversation persistence was added in the current pass above. Granola factual accuracy was not benchmarked. The live-recording flow was not exercised in the visual pass; its shared answer-copy change is covered by the component test and frontend checks.

Previous performance pass: performance and reliability fixes are committed as `80c7dc5` on `main`. Search is debounced, limited to 100 matching meetings with one excerpt each, and backed by a per-meeting transcript index. Search snippets handle Unicode safely; stale meeting responses cannot replace the current selection. Chat enforces its output limit and supports cancellation on Stop, clear, and navigation.

Ollama meeting chat now streams over a Tauri channel. First text appears immediately; later updates are batched every 50 ms. Stopped, failed, or length-limited answers are labeled incomplete and excluded from follow-up history. Known plain source markers become citation links; unknown IDs remain non-clickable. Streamed Gemma questions explicitly disable thinking, which otherwise consumed much of the 400-token budget. Summary generation keeps its previously tested temperature/reasoning profile. See [Ollama thinking controls](https://docs.ollama.com/capabilities/thinking).

Validation: 78 frontend workflow tests, three Markdown tests, TypeScript, 96 native summary/streaming tests, isolated frontend production build, native build, and signature verification passed. Three short synthetic Gemma streaming samples completed with source citations: first text 32–250 ms, completion 350–584 ms; later samples used a warm model/cache. This is not a long-meeting benchmark. Native checks on **Meetnola saved-note review** verified cancellation, a subsequent correct answer, its exact transcript citation, contextual follow-up, and the incomplete warning for an intentionally overlong request. The broader native suite still has an unrelated Bluetooth timeout precision assertion (159.999996 ms versus 160 ms).

Prior follow-up chat and Gemma sampling validation on `main`: Chat sends the last six successful exchanges separately from current meeting sources, removes old citation IDs from historical answers, and clears history with the conversation or meeting. Seventy frontend workflow tests, TypeScript, 92 native summary tests, an isolated production frontend build, and native build `20260908-2212-gemma-follow-ups` passed. The user approved restarting; that build is now installed, signed, and visibly active. Native UI checks on **Meetnola saved-note review** confirmed Gemma regeneration without the earlier invented implementation task, preservation of the custom title, a contextual follow-up with an exact transcript citation, and Escape focus restoration. A full quit/reopen preserved the Gemma selection, regenerated notes, and custom title. Parakeet Compact remains selected. The optional `live_meeting_follow_up_quality` test also passed against local Gemma, including rejection of an invented prior assignment.

Gemma recommendation: the user's requested small MLX candidate is `gemma4:e4b-mlx`, downloaded through Ollama. Google calls it E4B (8B total with embeddings, 4.5B effective); the installed artifact reports 8.1B, Safetensors, NVFP4, and Ollama shows 100% GPU execution. See the [Google model card](https://huggingface.co/google/gemma-4-E4B-it) and [official Ollama MLX tag](https://ollama.com/library/gemma4:e4b-mlx). Two default-temperature trials preserved all tested task assignments, but manual review of the repeat caught a validation condition attached to the wrong event. At temperature 0.2, all nine synthetic cases passed and manual review found the relevant facts intact: 2.58–4.58 seconds per case, median 3.23 seconds. The current Qwen baseline passed six of nine checks, median 1.08 seconds. These are short synthetic cases, not long-meeting performance claims. The new Gemma profile applies temperature 0.2 to Ollama Gemma 4 requests; other providers retain their settings. A narrow reassignment phrase check was expanded to accept "moved from Noah to Liam," with regression coverage still rejecting the old owner/deadline. Gemma is selected and its temperature 0.2 profile is active.

## Saved-note workspace and reliable edits

Active dev bundle: `/private/tmp/meetnola Dev.app`, build `20260909-0734-summary-fidelity`, with frontend hot reload on port 3118. The source-coverage fixes and updated standard template are installed and visually verified. Local Parakeet Compact and Ollama `gemma4:e4b-mlx` are selected; recording is stopped. The standalone tester remains unchanged.

Saved-meeting questions now retrieve the complete transcript through the existing meeting API instead of using only the loaded display page. Each answer retains its original notes/transcript source snapshot. Markdown citations open exact excerpts with recording timestamps where available; unknown IDs are non-clickable. Escape closes the excerpt and restores citation focus. Duplicate sends are suppressed; cleared, unmounted, or changed-meeting requests cannot append stale answers. Context retrieval failure stops the request before calling the model. Live/quick-note chat retains its existing context behavior; model context-window limits and factual accuracy remain separate concerns.

Citation validation: 68 frontend workflow tests, three Markdown tests, TypeScript, production frontend build, native dev build, signature verification, and diff checks passed. Native UI checks on the synthetic saved-note review confirmed a correct title-preservation answer, a transcript citation at 0:45, the exact original written-note excerpt, and keyboard dismissal/focus. A second question correctly declined to invent an implementation owner or deadline. This is bounded evidence, not general factual-quality acceptance; the earlier Qwen-generated summary contained an unsupported commitment, which the verified Gemma regeneration removed.

The saved-note toolbar is compact, with Copy in Meeting actions and accessible model/template controls. Generated sections use semantic H2 headings styled below the document title. Enhanced edits now save automatically through the existing native summary API on both saved-note screens. Writes are ordered, queued intermediate snapshots are coalesced, and Save remains available for retry. Status distinguishes unsaved, saving, failed, and saved. Pending writes continue after route unmount; regeneration awaits them and stops if saving fails. The editor is read-only during generation. Regenerated Markdown loads without falsely marking the document dirty. Switching note tabs preserves edits. Native window close hides the app and retains the running editor. The macOS Quit menu, Command-Q, and tray Quit now use a save handshake: flush delayed notes, drain title/summary writes, and exit only after success. The predefined macOS Quit item bypassed Tauri ExitRequested via Cocoa terminate; it is replaced with a custom item retaining the same label and shortcut. Failed writes remain retryable after their editor unmounts, and queues are shared per meeting so older failures cannot overwrite newer edits. A failed or timed-out flush keeps the app open. Recording, paused, processing, stopped-but-unsaved, and saving sessions block completion. Dock/system termination and force quit are not covered by this handshake.

AI title suggestions now apply atomically only to placeholder titles; explicit renames and existing titles survive enhancement. The frontend also checks the latest edited title before accepting a suggestion. Existing transcript display names remain consistent with explicit renames.

Validation: 62 frontend workflow tests, three Markdown tests, TypeScript, production frontend build, 88 native summary tests (one live-model test ignored), one native title-persistence test, two native quit-coordinator/session tests, native dev build, signature verification, and diff checks passed. Native UI checks used only the synthetic **Meetnola saved-note review**: checkbox save/reopen, retention across note tabs, Home save/reopen, regeneration without a false dirty warning, title preservation after regeneration/reopen, model/template controls and Escape focus, a half-screen layout check, immediate sidebar navigation after editing without Save, and window close/reopen after editing. Autosave regressions cover ordered/coalesced writes, unmount, failure/retry, and save-before-regenerate success/failure. Quit coverage includes the real delayed-note hook, stale failed writes after reopening, duplicate/stale quit requests, timeout/disposal, and native refusal. Native Command-Q was exercised while the synthetic original note visibly showed Saving; its final character survived full exit/reopen after the menu fix. An enhanced checkbox also survived quit/reopen. Recording refusal is covered by code/tests, without starting another recording. Earlier Qwen regeneration invented an implementation commitment from sparse source text; the Gemma comparison and current native verification are recorded above. General factual quality still requires broader evidence.

## Summary source coverage and quality evaluation

Run selected-summary checks from the repository root with `node frontend/scripts/eval-summary-claims.cjs`. This imports the actual frontend question builder and invokes the native streaming Q&A path with the eight cases in `frontend/tests/fixtures/summary-claims.json`. It uses local Ollama only; `MEETNOLA_EVAL_MODEL` defaults to `gemma4:e4b-mlx`, and `MEETNOLA_EVAL_REPORT` defaults to `/private/tmp/meetnola-claim-quality.json`. The command verifies request success, records complete answers, expected judgments, source text, and timing, and explicitly requires manual semantic review. Exit zero is not an accuracy pass. On macOS, run outside a restrictive sandbox if the HTTP client's system-configuration initialization fails.

Fixed two ways long meetings could produce incomplete summaries: sentence-boundary splitting could skip source text, and a failed transcript part was silently omitted. Chunking now advances from the actual boundary, including Unicode text; any failed part stops generation with a retry message. Existing cancellation and previous-summary recovery remain in place.

The standard template uses concise action checklists instead of a five-column table that demanded timestamps even for typed notes. It preserves discussion context and unresolved issues. Extraction prompts distinguish proposals, agreements, and commitments; local Qwen uses temperature 0.2 with direct answers. These are improvements to formatting and source handling, not a claim that factual accuracy is solved.

Validation: 88 native summary tests passed, including real HTTP request serialization, stopping before final synthesis after a failed second part, and rejecting a wrong action owner even when the correct name appears elsewhere in the report. The initial `20260905-1702-summary-quality` build was blocked from activation while the Mac was locked. It was activated on September 8 and then superseded by the verified workspace build above. The standalone tester remains unchanged.

Nine synthetic source cases and the opt-in real-model harness are tracked in `frontend/tests/fixtures/summary-quality.json` and `frontend/src-tauri/src/summary/quality_evals.rs`. Run with `CARGO_TARGET_DIR=target/meetnola MEETNOLA_EVAL_MODEL=qwen3.5:9b-mxfp8 cargo test --manifest-path frontend/src-tauri/Cargo.toml --features meetnola --lib live_summary_quality -- --ignored --nocapture`. Reports default to `/private/tmp/meetnola-summary-quality.json`; `MEETNOLA_EVAL_REPORT` overrides this. Checks now require owners, deadlines, and decisions in the correct section, with both bold and ATX Markdown headings supported. Cases include conditional offers, reassigned work, negative wording in confirmed tasks, and unassigned typed notes. These are bounded regressions; manually inspect the prose for omissions and unsupported claims.

The sparse-title regression now rejects inventing implementation or development work from a preservation check, while accepting a faithful checklist restatement. A September 8 comparison using all nine cases rejected a concrete-example prompt: it stopped the invented investigation for an unassigned issue but dropped Lee's confirmed task and the non-Latin detail. The prompt and template changes were fully reverted; the active dev build and model selection were unchanged. The baseline also failed budget-status and corrected-deadline checks. This pass strengthens evaluation only; 89 native summary regressions passed, with the live-model evaluation excluded from that unit count.

Accuracy remains open. Final 4B output misclassified an unapproved budget as rejected and omitted the assurance that existing records were intact. Final 9B output passed four of five cases, but promoted an explicitly uncommitted offer into an action item. Its five short-case calls took 1.48–3.88 seconds; this is not a long-meeting benchmark. Low reasoning was abandoned after the five-case run exceeded three minutes. Higher-precision `qwen3.5:4b-mxfp8` and `qwen3.5:9b-mxfp8` were downloaded for comparison; neither was selected in the app. Keep current local Parakeet and `qwen3.5:4b-mlx` selection until a candidate clears factual review. The source-coverage fixes are now active; factual accuracy remains the main unresolved enhancement issue.

Additional local experiments were rejected: a full editing pass introduced new detail; a constrained action reviewer removed a confirmed task using evidence about a different proposal; structured task extraction omitted committed work; neutral presence-penalty sampling did not fix assignment or owner errors. The installed 35B model also generated the uncommitted task with reasoning disabled. None of these review stages or sampling experiments was enabled in production, and no model selection changed. The follow-up commit strengthens regression coverage only. The Mac was still locked at the end of that September 5 evaluation; native UI checks resumed on September 8.

## Granola comparison: meeting browsing and note workspace

Inspected the running Granola Home, saved note, and enhanced-note selector through native UI without editing Granola data. Adopted its date-grouped meeting list, restrained reading width, and always-reachable meeting composer. Keep Meetnola's white shell and local providers. Calendar integration, shared workspaces, and cross-meeting chat are outside this batch; they need separate data and product decisions.

| Existing behavior | Decision and result |
| --- | --- |
| Home navigation, title search, all/recent views, draft, recovery, and import | Preserve; show search on Home, group by local calendar date, use compact rows, and disclose system details below the list. Recovery/device problems keep details expanded. |
| Saved original/enhanced notes, title autosave, explicit enhanced-note Save | Preserve; narrow the reading column, align editor text with the title, and remove the redundant Saved meeting label. |
| Meeting questions, recipes, Markdown answers, and clear | Preserve; keep a compact input dock visible while the document scrolls. Enter submits; Escape collapses answers and restores input focus. |
| Transcript timestamps, pagination, refresh, and copy | Preserve; add case-insensitive phrase search with highlighting, count, empty state, clear, and retry. Active search loads the complete transcript through the existing native API when the page is only partially loaded. Closing the sheet restores focus to Transcript. |

Passed: TypeScript, 36 workflow regression tests, three markdown tests, production frontend build, and diff validation. New regression coverage includes date/year boundaries and invalid dates, literal punctuation/HTML-safe highlights, later-page matches, retry after read failure, and stale-response isolation. Native checks covered Home search across all 45 meetings, no-match/clear, draft entry without recording, highlighted transcript matches/timestamps, long enhanced-note scrolling with the dock visible, a grounded local Qwen answer, and Escape focus return. Captures were 768 × 966, 568 × 777, and 1024 × 768 (scaled desktop captures, not measured CSS viewports). Dense summary tables keep local horizontal scrolling at compact widths; the page and assistant remain usable.

Recording and note persistence logic are unchanged. The known sparse-source summary grounding issue remains open. Dev hot reload is restored on port 3118; native build identity remains `20260905-1612-fast-qwen`. No standalone package rebuild or push in this batch. Work stays on local `main`.

## Uniform surfaces and faster local Qwen

The shell, Home, Settings, loading screen, and shared document page now use the existing white `bg-background` token; the native window background is white too. This supersedes the earlier warm-center treatment and removes the sidebar/title-bar mismatch. Navigation, editing, and semantic model-selection colors are preserved. Native Settings, Home, and saved-note views were checked after hot reload and native restart.

Downloaded and selected `qwen3.5:4b-mlx` (4.0 GB download, NVFP4) in the existing Ollama provider. Selection persisted after restart. A synthetic three-bullet prompt through the app's OpenAI-compatible API took 45.02 seconds with default reasoning and 0.53 seconds with reasoning disabled; the existing `qwen3.6:35b-mlx` took 16.26 and 0.80 seconds respectively. These are individual short-prompt observations, not controlled throughput or long-meeting benchmarks. The shared native client now disables reasoning for canonical Ollama Qwen 3.5/3.6 requests. The in-app enhancement completed within the 9.4-second observation interval, but expanded sparse source notes with unsupported detail; summary grounding remains a quality follow-up, not a passed check. A focused in-app question correctly answered that the custom meeting title must be preserved.

TypeScript, all 31 frontend workflow tests, the native provider/request serialization regression, native dev build, and strict ad-hoc signature verification passed. Regenerated stale Tauri dev-cache artifacts that referenced the removed recovery worktree. Current dev build is `20260905-1612-fast-qwen` in `/private/tmp/meetnola Dev.app`, with hot reload on port 3118. Local Parakeet is unchanged and recording is stopped. The standalone tester has not been rebuilt. Work remains on local `main`; nothing was pushed.

## Visual consistency pass

Scope: address the six visual-review findings using the existing editor, navigation, Radix controls, and installed Markdown renderer. Keep a warm neutral surface with compact document controls; no provider, storage, or recording redesign.

| Behavior | Decision |
| --- | --- |
| Draft, live, and saved note editing; title and note autosave | Preserve; share a flatter document surface and compact header |
| Recording entry/stop, recovery, and enhanced-note explicit save | Preserve |
| Transcript sheet, timestamps, pagination, and copy | Preserve; move the labeled opener beside document controls |
| Sidebar navigation, search, edit/delete confirmation, and keyboard access | Preserve; use one row action menu and more title space |
| Model selection, endpoints, language, and save | Preserve; clarify labels and allocate more width to the model |
| Assistant source context and requests | Preserve; render Markdown lists, links, and paragraphs in answers |

Implemented and verified on `codex/meetnola-visual-polish`: shared document styles, 240px minimum note surface (previously 420px for saved notes), visible Transcript/Enhance controls, folder overflow menu, neutral Settings styling, Meetnola branding, wider sidebar titles with one action menu, labeled provider/model fields, and Markdown assistant answers. The installed `react-markdown`/`remark-gfm` packages render answers without accepting raw HTML. Informational alerts retain their semantic color; the existing editor, transcript sheet, and enhanced-note Save behavior remain.

Passed: TypeScript, 26 workflow tests, three markdown tests, onboarding check, production frontend build, and `git diff --check`. Native dev checks covered draft entry without recording, live notes at wide and compact sizes, Stop/save/reopen, saved transcript timestamps, formatted Qwen checklists, model picker without changing selection, sidebar edit via keyboard with focus return, and delete confirmation canceled without deletion. Captures were 1024 × 768 (scaled desktop), 754 × 1012, and 591 × 850, not measured CSS viewports. Saved-note actions and the collapsed assistant now fit the initial 754 × 1012 view; at 591px capture width, toolbar actions wrap and Settings fields stack. The selected Settings tab scrolls into view. Recording is stopped; the hot-reload frontend is restored on port 3118. The packaged tester was not rebuilt, and nothing was merged or pushed.

Synthetic recording `meeting-recording-meeting-1788647839126` preserved its notes and two transcript segments at 0:29 and 0:31. This exposed a title initialization race: its custom draft/recording title reopened as the first note line. The follow-up fix makes user title edits authoritative within a recording session, ignores stale asynchronous metadata, and restores the editable native session title on reload. The note-derived fallback for untitled meetings remains unchanged.

Title persistence passed in the native dev app: **Meetnola title persistence verified** (`meeting-recording-meeting-1788649090051`) retained its custom draft title through Start, Stop, Home, and reopening, with a different first note line and one saved transcript segment at 0:45. TypeScript, all 31 workflow tests (including late initialization, UI/tray saves, reload synchronization, and a new-session reset), three markdown tests, the onboarding check, and the production frontend build passed. Recording is stopped. These frontend changes are active through hot reload; the packaged tester has not been rebuilt.

## Note workflow design batch

Scope: make drafting, recording entry, and reopened note editing predictable without changing audio, recovery, or enhancement providers.

| Behavior | Decision |
| --- | --- |
| Local draft persistence and recording seeding | Preserve; opening a draft must not start audio |
| Home, sidebar, and call-banner recording entry | Preserve explicit recording entry; distinguish it from **New note** |
| Original notes and titles after stop/reopen | Improve with the existing editor, automatic saving, visible failure/retry, and save-before-Home |
| Enhanced-note editing and explicit summary save | Preserve in this batch |
| Recovery, transcript persistence, Parakeet, and Qwen | Preserve |

Implemented on `codex/meetnola-note-workflow` and consolidated into local `main` by fast-forward through `c5a3d78` on 2026-09-05. Nothing was pushed. The existing local draft remains a single scratchpad; this batch does not introduce a separate note collection. The build badge was also moved to the bottom edge because it obscured **Start recording**.

Passed: TypeScript, 21 recording/workflow regression tests, 3 markdown tests, and native dev checks for **New note** / **Draft → Open** without recording, draft persistence, explicit recording with draft seeding, stop, post-stop editing, reopening, and immediate Home navigation after editing the reopened note/title. Synthetic evidence is **Meetnola reopened edit verified**. The build badge no longer overlaps the tested Home, recording, or saved-meeting actions. Tested at the current desktop window size; narrow layouts and packaged builds were not retested. Parakeet transcription and local Qwen enhancement settings are unchanged.

The follow-up batch adds notes-aware meeting questions/recipes, stored dates in the native meeting-list response, and **View all meetings** with title search and an empty-results recovery action. TypeScript, 22 frontend regression checks, four native quality tests, and the native dev build passed. Live checks confirmed a local Qwen answer on a notes-only meeting, all 42 meetings in the full list, matching and empty searches, clearing search, and dates displayed after restarting the rebuilt app.

Navigation accessibility is implemented: named collapsed controls, a navigation landmark, selected/expanded states, keyboard-operable meeting rows, visible focus and row actions, focused search/meeting expansion, and focus return after closing the title dialog. TypeScript and all 22 workflow regression tests passed. Native dev checks passed for Tab/Enter meeting navigation, Escape from the title dialog, Space to collapse meetings with hidden rows removed from the tab order, and search expansion/clearing. This closes the six findings from the bounded design review; a full VoiceOver audit remains outside the verified coverage. Narrow-window checks are recorded below. Enhanced-note editing still uses its explicit save action.

Current dev build: `20260905-1329-discovery` in `/private/tmp/meetnola Dev.app`, with frontend hot reload on port 3118, including the timestamp fix through `c5a3d78`. The temporary app contains its helper binaries and resources; strict ad-hoc signature verification passed. This checkout is now on local `main`; the packaged tester remains at `20260905-ae4bd26`. Earlier no-merge statements below describe the state at each validation pass.

The fully merged recovery worktree was removed on 2026-09-05. Its build cache was preserved at `/Volumes/ServerData/Apps/meetily/target/meetnola`; set `CARGO_TARGET_DIR` to that path to reuse it. The packaged tester is now at `target/meetnola/release/bundle/macos/meetnola Tester.app`, and strict signature verification passed after relocation. The existing main-checkout cache and running dev app were preserved. Recovery-worktree paths below are historical.

## Compact-window and package verification

Scope: preserve navigation, note saving, model choices, and page actions; improve shared content width, title wrapping, and compact AI controls. No navigation or editor replacement.

| Behavior | Decision |
| --- | --- |
| Sidebar collapse, page navigation, Home discovery, Settings tabs | Preserve; remove duplicate content margin and contain tab scrolling |
| Title autosave and editing | Preserve; recalculate title height on width changes |
| AI follow-up recipes and source context | Preserve; enable the Send button for notes-only context as Enter already does |
| Sticky AI panel | Preserve at large widths; use normal document flow at compact widths to avoid covering notes |

Native dev checks passed at an 834 × 768 capture and a compact 556 × 812 capture (window-image dimensions, not a measured CSS viewport). Before: expanded navigation left an extra 256px margin plus 32px padding in `MainContent`; narrow titles clipped, the sticky AI panel covered note text, and Settings tabs widened the page. After: the duplicate 288px spacing is gone, titles wrap when resizing/collapsing the sidebar, compact controls scroll below the editor, and keyboard End reaches Beta within the scrolling tab strip. Home and **New note** fit; the draft stays **Not recording**. The notes-only **Send question** button returned “Autosave was verified” from local Qwen on the synthetic reopened-edit record.

Passed: TypeScript, 22 workflow regression tests, three markdown tests, the onboarding check, production frontend/native release builds, and strict ad-hoc signature verification. Packaged tester `20260905-ae4bd26` is at `/Volumes/ServerData/Apps/meetily-recovery/target/release/bundle/macos/meetnola Tester.app`. It ran from `tauri://localhost` with the dev server stopped. Packaged checks passed for draft entry without recording, all 42 meetings with dates, compact layout, and editing the synthetic **Meetnola reopened edit verified** note followed by immediate Home navigation and reopening. Its text is now “Synthetic packaged edit. Autosave verified.” Audio capture was not repeated; Home audio-device readiness still displayed **Checking…** during this pass, so capture readiness is not newly verified. The packaged app was closed and the existing hot-reload dev workflow restored. No merge or push. This is compact desktop validation, not a mobile-support, notarization, or full accessibility claim.

Audio retry at 14:52 PDT on 2026-09-05 passed in the dev app: recording started, synthetic system speech transcribed, Stop saved three segments, and the title, notes, and transcript survived reopening **Meetnola audio retry verified** (`meeting-recording-meeting-1788645074580`). Home then showed both microphone and system audio as **Default**, with 43 meetings. Recording is stopped. No code change or permission reset was needed; the earlier device-readiness observation is superseded for this dev run.

Saved transcript timestamp fix verified at 15:06 PDT: the sheet previously read `audio_start_time` from virtualized segments that expose `timestamp` instead. It now renders typed saved API transcripts directly. The same synthetic meeting displays **0:25**, **0:29**, and **0:48**, including after **Refresh** and reopening the sheet; no stored-data change was required. TypeScript, 24 workflow tests (including API-to-row rendering and missing/zero/invalid timestamp coverage), three markdown tests, and the onboarding check passed. The fix is active through dev hot reload; the packaged tester has not been rebuilt with it. No merge or push.

## Quality fixes (2026-09-05)

- Code commit `32fb2ab` on `codex/meetnola-quality-fixes` addresses the seven review findings: checkpoint retention, Unicode-safe truncation, idempotent saves, editor clearing, saved-title persistence, accurate **New recording** behavior, and notes-only enhancement.
- Packaged tester build `20260905-32fb2ab` replaces the earlier bundle at the recovery worktree's app path. Local `main` was fast-forwarded through `3aee9b4`, which also refreshes Home's meeting list and finishes pending note/title saves before returning Home. Nothing was pushed.
- Passed: TypeScript, 16 frontend regression checks, 3 Rust tests using Unicode inputs and isolated SQLite databases, markdown/onboarding checks, production frontend/native builds, and ad-hoc signature verification. Dependencies were synchronized to the existing lockfile.
- Browser verification used the actual application editor: **Clear** emptied its visible document and stored state; subsequent typing did not restore old text.
- Earlier native retesting waited inside CoreAudio during CPAL input-device discovery. After the user's audio approval, two dev recordings started and stopped successfully. Native **Clear**, replacement notes, post-stop title edits, immediate Home navigation, and reopening passed. Synthetic audio produced two saved transcript segments; the transcript and a post-stop note edit survived reopening. TypeScript and all 16 frontend regression checks passed again after the Home fix.
- Synthetic evidence remains as **Meetnola dev quality verified** (notes only) and **Meetnola dev audio verified** (two transcript segments). No test records were deleted.
- Groq returned `expired_api_key`; the user then selected local Qwen enhancement. The tester now uses Ollama at its default local endpoint with the already installed `qwen3.6:35b-mlx` model (NVFP4, safetensors; Ollama 0.33.1). Notes-only enhancement succeeded and survived reopening, producing a summary, decision, and action item. Its generated title is **Review of Synthetic Quality Check and Parakeet Model Decisions** (formerly **Meetnola dev quality verified**). Credentials were not inspected or changed. Local Parakeet remains selected for transcription.
- The earlier quality pass used dev badge `20260905-1244-4957e34` with frontend code through `3aee9b4`. The newer running dev build is recorded above. This session uses a standalone Next dev server, so Rust changes require rebuilding and relaunching the native app. That earlier packaged release has been superseded by the design build recorded above.

## Verified recovery baseline

Meetnola is maintained as an independent fork with selective upstream adoption. See [Meetnola maintenance](../meetnola-maintenance.md) for branch policy, supported providers, and validation commands.

- Recovery code: `54e3af9` on `meetnola/recovery-baseline`, including recording/note fixes in `7347b94`.
- Final packaged tester: `meetnola Tester v0.4.0 (bundle, 20260905-54e3af9)` at `target/release/bundle/macos/meetnola Tester.app` in the recovery worktree.
- Local Parakeet Compact remains selected by user choice. System-audio permission was granted by the user.
- Validation passed: TypeScript, 10 recording/updater regression tests, 3 markdown tests, onboarding model checks, Rust check, production frontend build, native app bundle, and ad-hoc signature verification.
- Packaged UI validation: synthetic speech transcribed; title, notes, and transcript survived navigation, stop, and reopening. A second recording on the final build saved two transcript segments; editing its note after stop persisted when reopened.
- Synthetic evidence remains in the tester as **Meetnola recovery smoke test** and **Meetnola final build verification**. No test records were deleted.
- Upstream automatic updates are disabled for Meetnola. Cloud transcription is unsupported in this baseline. Live summary-provider behavior and notarized distribution were not validated.
- Local promotion uses a fast-forward into `main`; remote publication is separate and has not been performed.

## Historical product and packaging snapshot (2026-03-09)

The sections below preserve the earlier handoff. Build versions and outstanding-work statements below are historical; the verified baseline above takes precedence.

## Purpose

This handoff captures the latest product, packaging, routing, UI, and macOS testing work that is not fully reflected in the longer-lived docs yet.

## Current packaged tester build

- Product name: `meetnola Tester`
- Bundle id: `com.meetnola.tester`
- Packaged app path: `target/release/bundle/macos/meetnola Tester.app`
- Tester app data folder: `~/Library/Application Support/com.meetnola.tester/`
- Tester DB: `~/Library/Application Support/com.meetnola.tester/meeting_minutes.sqlite`
- The latest packaged build used during this pass showed an on-screen build badge:
  - `meetnola Tester v0.3.2 (bundle, 20260309-0932-c796cf6)`

## Why packaged builds matter on macOS

- `tauri dev` is not trustworthy for macOS system-audio permission testing.
- TCC / System Audio Recording permission attaches to the packaged bundle identity, not the transient dev binary.
- The packaged tester app is the correct target for:
  - system audio permission prompts
  - system audio recording validation
  - startup timing validation
  - peer testing

## Meetnola-specific build and run paths

- Dev tester app:
  - `cd frontend && ./run-meetnola.sh`
  - or `cd frontend && pnpm run tauri:dev:meetnola`
- Packaged tester app:
  - `cd frontend && ./build-meetnola.sh`
  - or `cd frontend && pnpm run tauri:build:meetnola`
- Tauri config override:
  - `frontend/src-tauri/tauri.meetnola.tester.conf.json`

## Recording entry path is unified

These now intentionally go through the same route and should no longer be treated as separate features:

- Home `New note`
- Sidebar `Start Recording`
- Call-detection banner entry

Shared routing helper:

- `frontend/src/lib/quickNoteRoute.ts`

Expected behavior:

- New sessions route into `/quick-note`
- There should not be a separate “sidebar recording page” behavior anymore

## Saved-note / saved-meeting UX model

The product is moving toward a Granola-style hierarchy:

- Main panel is document-first
- Transcript is hidden by default and opens from the wave button
- AI follow-up composer lives at the bottom
- If no AI summary exists yet, the main CTA is `Enhance notes`

Primary files:

- Quick note saved view:
  - `frontend/src/app/quick-note/page.tsx`
- Saved meeting details view:
  - `frontend/src/app/meeting-details/page-content.tsx`
- CTA:
  - `frontend/src/components/EnhanceNotesCta.tsx`
- Notes-aware summary prompt:
  - `frontend/src/lib/enhanceNotes.ts`

Current state:

- The hierarchy is flatter and quieter than before
- The saved quick-note stop screen and reopened meeting screen are closer than before, but still not fully shared
- Both now support a top-right overflow action surface instead of diverging on basic meeting actions
- Saved-note bottom controls are anchored more like Granola and the transcript control uses a waveform-style glyph
- Remaining work is mostly visual compression and shared-shell extraction, not route architecture

## Notes-driven title fallback

Meeting titles are no longer dependent only on transcript/summary output.

Current behavior:

- If a meeting still has a generated or placeholder title such as `Meeting 2026-...` or `New note`
- and the saved notes contain meaningful content
- the app derives a title from the first useful note line and persists it

This now happens through the native note-save path, not only through summary generation.

Key files:

- `frontend/src-tauri/src/notes_commands.rs`
- `frontend/src/lib/suggestMeetingTitle.ts`
- `frontend/src/app/quick-note/page.tsx`
- `frontend/src/app/meeting-details/page-content.tsx`

## Build identity

Tester builds now expose visible build identity in-app so it is possible to confirm which bundle is open.

Files:

- `frontend/src-tauri/build.rs`
- `frontend/scripts/tauri-auto.js`
- `frontend/src-tauri/src/lib.rs`
- `frontend/src/lib/buildInfo.ts`
- `frontend/src/components/BuildIdentityBadge.tsx`
- `frontend/src/components/About.tsx`
- `frontend/src/app/settings/page.tsx`

## Groq-first product defaults

Fresh installs were changed toward Groq-first behavior:

- Summary default: `groq`
- Transcript default: `groq`
- Local models are optional rather than required up front
- Groq / OpenAI keys are shared across transcript + summary settings

Related files include:

- `frontend/src-tauri/src/config.rs`
- `frontend/src-tauri/src/database/commands.rs`
- `frontend/src-tauri/src/database/repositories/setting.rs`
- `frontend/src/contexts/ConfigContext.tsx`
- `frontend/src/components/ModelSettingsModal.tsx`
- `frontend/src/components/TranscriptSettings.tsx`
- onboarding flow under `frontend/src/components/onboarding/`

## macOS system-audio reality

Current macOS behavior is more nuanced than the older docs suggest:

- Default backend is `Core Audio`
- `ScreenCaptureKit` remains available but is intended for loopback-style devices
- `ScreenCaptureKit` should not be treated as the default path for normal playback-output capture
- Packaged app permission testing is required for trustworthy macOS system-audio validation

Key files:

- `frontend/src-tauri/src/audio/capture/backend_config.rs`
- `frontend/src-tauri/src/audio/recording_preferences.rs`
- `frontend/src/components/AudioBackendSelector.tsx`
- `frontend/src-tauri/src/audio/capture/core_audio.rs`
- `frontend/src-tauri/src/audio/stream.rs`

## Startup / launch behavior

- The app now uses build identity and a more stable startup path than earlier in the session
- `clean_run.sh` is improved, but packaged builds remain the correct validation path for peer testing
- The DMG bundling step may still fail even when the `.app` bundle succeeds

Practical implication:

- For local validation, the `.app` bundle is sufficient
- DMG failure does not necessarily mean the app bundle is invalid

## Tester distribution / launch reality

The tester README is now the operational source for peer setup:

- `docs/meetnola-tester-readme.md`

Important current facts:

- The `.app` bundle works
- The `.dmg` step still fails
- The app is ad-hoc signed, not notarized
- Some transfer/extraction paths may strip executable permissions from binaries inside the bundle
- `frontend/build-gpu.sh` now normalizes executable bits on `Contents/MacOS/*` after build, even if DMG bundling fails later

If a tester reports launch failures like error `111`, `permission denied`, or `Launch failed`, the README now includes:

- `chmod +x .../Contents/MacOS/meetily`
- `chmod +x .../Contents/MacOS/ffmpeg`
- `chmod +x .../Contents/MacOS/llama-helper`
- quarantine removal with `xattr -r -d com.apple.quarantine`

## Key docs already present in `docs/wip/`

- `logging-overhaul-plan.md`
- `recording-transcription-stability-plan.md`
- `handoff-logging-stability-phase1.md`
- `handoff-logging-stability-followup.md`
- `handoff-ui-stuck-recovery.md`
- `handoff-recording-ui-churn-fix.md`
- `handoff-groq-first-defaults.md`
- `handoff-meetnola-tester-build.md`
- `handoff-macos-system-audio-restore.md`
- `handoff-macos-audio-backend-followup.md`

## Recommended next steps

1. Continue visual simplification of saved-note / saved-meeting surfaces.
2. Extract a shared saved-meeting shell if quick-note and meeting-details continue to drift.
3. Keep validating macOS system audio only in the packaged `meetnola Tester.app`.
4. Fix remaining macOS branding leakage (`Meetily` identity in menu bar / app switcher).
