I verified every lead against source. Several confirmed, two corrected, and I found the two biggest causes neither of you had.

---

# 1. Executive verdict

All three complaints trace to the same happy path, and the dominant causes are **not** the ones in the leads. Live transcript is architecturally batch-per-utterance (confirmed), but the reason it feels broken is that **Whisper is loaded on every start and unloaded on every stop**, so the first seconds of every meeting produce nothing, and **VAD has no maximum utterance length**, so a speaker who talks 45 seconds without a 400ms pause gets zero on-screen text for 45 seconds. "Slow" is dominated by **~6.5s of hardcoded `setTimeout` sleeps on the stop path** waiting for work Rust already finished, plus **671 `console.*` calls funneled through an unconditional, serialized IPC bridge in production builds**. "Confusing flow" has a concrete root: the live recording workspace and the draft-note surface are the **same route** (`/quick-note`), disambiguated only by a one-shot sessionStorage token.

---

# 2. Findings

## CONFIRMED

**F1 — Live transcript is utterance-batched, not streamed.** `frontend/src-tauri/src/audio/pipeline.rs:835-856` sends a segment to transcription only when VAD emits `SpeechEnd`. `frontend/src-tauri/src/audio/vad.rs:243-273` pushes a segment only on that transition. No partial/interim emission anywhere.

**F2 — `NUM_WORKERS = 1`.** `frontend/src-tauri/src/audio/transcription/worker.rs:67`. Confirmed. But this is **not** a top cause — serial is correct given the design, and the pool is one utterance deep. Don't raise it; see F5/F6 instead.

**F3 — Startup gated on frontend bootstrap, 15s blind fallback.** Window is `"visible": false` (`frontend/src-tauri/tauri.conf.json`, `app.windows[0]`). It is only shown by `frontend_bootstrap_complete` (`frontend/src-tauri/src/lib.rs:180-203`), which the frontend calls only after `get_onboarding_status` resolves (`frontend/src/app/layout.tsx:131-157, 195`). Fallback sleeps 15s (`lib.rs:571-589`). Until then the user sees **nothing at all** — no splash, no window.

**F4 — `clean_run.sh` pre-warm orphans Next and hangs the script.** `frontend/clean_run.sh:194` captures `$!` of **pnpm**, not the `next dev` child; `:206-207` sends a bare SIGTERM and then blocks on `wait`. The `cleanup()` trap at `:34-39` only handles `NEXTJS_DEV_PID`, never `NEXTJS_PREWARM_PID`.

Evidence, not theory — the last run on this machine:
```
frontend/logs/clean-run-20260911-004801.log  (5 lines, ends here)
  Pre-warming Next.js (compiling home page into .next/ cache)...
  Pre-warm complete — home page and app/layout.js are ready
```
It never printed `Building Tauri app...`. And right now:
```
98557 pnpm dev                              12:52AM
98664 next dev --webpack -p 3118            12:52AM
98670 next-server (v16.3.4)  → LISTEN :3118
```
The orphan has held port 3118 for ~12 hours. Every subsequent `tauri:dev` webview loads *that* stale server.

**F5 — Flow sprawl, with a specific root cause.** `/` hard-redirects to `/quick-note` whenever recording is live (`frontend/src/app/page.tsx:178-188`). `createQuickNotePath()` vs `createDraftNotePath()` (`frontend/src/lib/quickNoteRoute.ts:23-31`) differ only by a `?fresh=<ts>` token consumed from sessionStorage. The live meeting workspace is literally the quick-note page. A reload during recording drops the token by design (`quickNoteRoute.ts:15-21`) and the page reverts to draft-note semantics while native capture is still running.

## CORRECTED

**C1 — VAD redemption is 400ms, not ~2000ms.** `pipeline.rs:727`: `let redemption_time = if cfg!(target_os = "macos") { 400 } else { 400 };` (both branches identical; the comment above says 900ms for macOS). The 2000ms figures in `vad.rs:562-591` are batch-file retranscription tests, not the live path. `min_speech_time = 250ms` is correct (`vad.rs:56`).

**C2 — The mixing window is 600ms, not 50ms.** `pipeline.rs:27-28`:
```rust
// Use 50ms windows for mixing
let window_ms = 600.0;
```
The comment is stale and `CLAUDE.md` repeats the wrong number. This is a **12x** understatement of the first latency stage.

**C3 — Rendering is not the bottleneck.** The live panel uses `@tanstack/react-virtual` with a threshold of 10 segments (`frontend/src/components/VirtualizedTranscriptView.tsx:40,137,224`) and a memoized row component (`:67`). The full-array re-sort in `TranscriptContext.tsx:276-280` is real but O(n log n) on a few hundred items — not user-visible. Drop this from the list.

**C4 — `is_partial` is dead.** Plumbed Rust→event→context→type but read by **zero** render paths. Not a visual cause.

## NEW — these are the actual causes

**N1 (P0) — Whisper is loaded on start and unloaded on every stop.** Load: `worker.rs:53` → `engine.rs` `get_or_init_whisper` → `load_model()`. Unload: `frontend/src-tauri/src/audio/recording_commands.rs:727` `engine.unload_model().await` on every stop. The load happens **inside the spawned transcription task**, *after* `recording-started` is emitted (`recording_commands.rs:330`) and after audio capture is already running. So every meeting begins with a dead transcript window while a multi-GB model loads and allocates Metal buffers; queued VAD segments then dump in a burst.

Worse — during that window, `worker.rs:136-139` **silently discards** chunks when the model isn't loaded, while still incrementing `chunks_completed`. The "ZERO chunk loss" guarantee at `worker.rs:369-374` is decorative: the counters match, the audio is gone.

**N2 (P0) — No maximum utterance length.** Nothing in `vad.rs` or `pipeline.rs` caps segment duration. `vad.rs:215-219` only *warns* past 62 seconds. Continuous speech with no sub-400ms gap → one giant segment → nothing on screen until the speaker pauses. This is the literal "transcript is not streaming properly."

**N3 (P0) — ~6.5s of hardcoded sleep on every stop, after all work is done.** Rust `stop_recording` already `await`s the full transcription task join (`recording_commands.rs:626-641`) before returning. The frontend then re-waits: a 500ms-interval poll loop (`frontend/src/hooks/useRecordingStop.ts:186-218`), then an unconditional `await sleep(4000)` (`:230`), then `await sleep(500)` (`:253`), then a `setTimeout(..., 2000)` before navigating (`:379-386`).

And the poll's fast-exit is dead: `listen('transcription-complete')` at `:180` waits for an event emitted **only from `lib_old_complex.rs:1103,1297`**, which is not declared as a module in `lib.rs:40-61` — dead code. That listener can never fire.

Then: `if (isCallApi && transcriptionComplete == true)` at `:258`. If the 60s poll times out, **the meeting is never written to SQLite**. That is why "recovery" is a first-class home-screen feature.

**N4 (P0) — Console bridge is unconditional and serialized, in production.** `frontend/src/app/layout.tsx:353-355` overwrites `console.log/warn/error` globally with no `NODE_ENV` guard. Every call is `JSON.stringify`'d (`:295-331`) and pushed through a **strictly sequential promise chain** (`:338-350`) — each log awaits the previous Tauri IPC round-trip. There are **671** `console.*` calls in `frontend/src/`, concentrated exactly on the hot path: `TranscriptContext.tsx` (36), `RecordingControls.tsx` (38), `useRecordingStop.ts` (32), `analytics.ts` (69). `TranscriptContext.tsx:299,331,234,270,287` fire ~5 IPC round-trips **per transcript segment**.

**N5 (P1) — `SEQUENCE_COUNTER` never resets; the frontend's ordering logic is dead after recording #1.** `worker.rs:15` is a process-global `AtomicU64` with no reset (the only `store(0)` is in dead `lib_old_complex.rs:2418`; `reset_speech_detected_flag` next to it *is* wired up — the sequence counter was missed). The frontend's `lastProcessedSequence` resets to 0 on every listener re-mount (`TranscriptContext.tsx:194`). On the second recording of a session, ids start at e.g. 47, so the in-order drain at `:201-208` never matches and everything falls through the "recent/stale" heuristic at `:218-237`. Ordering degrades to a timing race.

**N6 (P1) — The main transcript listener is torn down at the exact moment recording starts.** `TranscriptContext.tsx:368` — the effect depends on `[currentMeetingId]`, and `setCurrentMeetingId` is called from inside the `recording-started` handler (`:131`). So on start: `unlistenFn()` runs, then `setupListener()` re-registers via an **async** `listen()` round-trip. Tauri events are not buffered. Any `transcript-update` emitted in that gap is **lost permanently**. The effect at `:187` re-registers the recording-started/stopped listeners for the same reason.

**N7 (P1) — Whisper is configured for the wrong tradeoff on the live path.**
- Beam search, not greedy: `whisper_engine.rs:526-529`, `beam_size` from `hardware_detector.rs:204-251`.
- `detect_memory_gb()` **hardcodes 8** on macOS (`hardware_detector.rs:109-118`). On the Mac Studio M4/128GB, `memory_gb >= 16` is false → tier is `High`, not `Ultra` → `beam_size: 3`. Note the fix is *not* to report real RAM — that would promote to `Ultra` and `beam_size: 5`, making it slower.
- `max_threads` is computed and then **discarded** — `whisper_engine.rs:571-574` has an empty `if let Some(_max_threads)` body. All thread adaptation is dead code.
- `set_token_timestamps(true)` (`:547`) enables token-level timestamp computation while `set_no_timestamps(true)` (`:546`) throws the result away. Pure waste per segment.
- `ctx.create_state()` on every call (`:584`) — fresh KV cache + Metal buffer allocation per utterance instead of once per worker.

**N8 (P2) — Per-segment IPC nobody listens to.** `worker.rs:283-290` emits `transcription-progress` for every chunk. Nothing in `frontend/src/` listens (only `retranscription-progress` exists, in `RetranscribeDialog.tsx:131`). Separately, Rust registers its **own** `app.listen("transcript-update")` (`recording_commands.rs:301-323`) to persist segments, so each update crosses the event bus and is JSON-deserialized twice.

**N9 (P2) — ~4,400 lines of dead Rust in-tree.** Not declared in `lib.rs:40-61` or `audio/mod.rs`: `lib_old_complex.rs` (2,437), `audio_v2/` (9 files), `audio/core-old.rs` (923), `audio/recording_commands.rs.backup`. This actively misleads — N3's dead event listener exists *because* `lib_old_complex.rs` looks live.

---

## Latency budget (Whisper, happy path)

| Stage | Cost | Source |
|---|---|---|
| Ring-buffer mixing window fill | 600ms | `pipeline.rs:28` |
| VAD redemption after speech ends | 400ms | `pipeline.rs:727` |
| Utterance accumulation | **unbounded** | no cap in `vad.rs` |
| Whisper beam-3 + fresh state | segment-proportional | `whisper_engine.rs:526,584` |
| Frontend debounce | 10ms | `TranscriptContext.tsx:345` |
| **Floor after you stop talking** | **~1.0s + inference** | |
| **First segment of a meeting** | **+ full model load** | `worker.rs:53` / `recording_commands.rs:727` |

---

# 3. Prioritized fixes

### P0

1. **Keep the transcription model resident across recordings.** Delete the unload at `recording_commands.rs:727` (and the Parakeet twin at `:701`); load once at app idle or first use. *Impact: transcript starts appearing within ~1s of the first sentence instead of after a multi-second model load, on every single meeting.* Biggest single win.

2. **Cap utterance length in `pipeline.rs`.** Force-emit the in-flight VAD segment at ~8s even without `SpeechEnd` (`vad.rs:277-280` already accumulates `current_speech`; add a length check in `process_chunk` and push a segment). *Impact: continuous speakers get text every ~8s instead of a 45s blackout. This is the "not streaming properly" fix.*

3. **Delete the stop-path sleeps.** Remove `useRecordingStop.ts:230` (4000ms) and `:253` (500ms); cut the nav `setTimeout` at `:379` to ~0. Also remove the dead `transcription-complete` listener at `:180` and gate on `stop_recording`'s own returned `status` instead of polling. *Impact: stop → meeting-details drops from ~7s to under 1s.*

4. **Gate the console bridge on `NODE_ENV !== 'production'`, and batch it.** `layout.tsx:286-363`. Replace the serial `flushChain` with a buffer flushed on a 250ms interval. *Impact: removes ~5 blocking IPC round-trips per transcript segment and the constant background serialization tax. This is most of "app feels slow."*

5. **Fix `transcriptionComplete == false` → meeting never saved.** `useRecordingStop.ts:258`. Always write to SQLite; use the flag to decide whether to warn, not whether to persist. *Impact: eliminates the silent data-loss path that recovery exists to paper over.*

### P1

6. **Reset `SEQUENCE_COUNTER` per recording session.** Add a `reset_sequence_counter()` alongside `reset_speech_detected_flag()` in `worker.rs:21` and call it from `recording_commands.rs:287` and `:458`. *Impact: restores in-order transcript delivery for the 2nd+ recording in a session.*

7. **Stop re-mounting the transcript listener on `currentMeetingId`.** `TranscriptContext.tsx:368` — hold `currentMeetingId` in a ref, drop it from the dep array, register the listener once on mount. Same for the effect at `:187`. *Impact: closes the guaranteed event-loss window at the start of every recording.*

8. **Switch the live path to greedy + reuse state.** `whisper_engine.rs:526` → `SamplingStrategy::Greedy`; hoist `create_state()` (`:584`) to once per worker; set `set_token_timestamps(false)` (`:547`). Keep beam search for `retranscription.rs`/`import.rs`. Separately, either wire `max_threads` into whisper.cpp or delete the dead `if let` at `:571-574`. *Impact: roughly 2-3x faster per-segment inference with negligible live-transcript quality loss.*

9. **Split the recording workspace from the draft-note surface.** Give live recording its own route (`/recording` or `/meeting/live`) instead of `/quick-note?fresh=<ts>`; make the redirect at `page.tsx:186` point there. Drop the sessionStorage start token. *Impact: fixes the reload-during-recording desync and removes the single most confusing piece of IA.* Also remove the toast-action + auto-navigate double path at `page.tsx:135-157` and `useRecordingStop.ts:365-386` — pick one.

### P2

10. **Fix `clean_run.sh` pre-warm, or delete it.** `:194` — launch with `setsid`/process-group and `kill -- -$PGID`, add `NEXTJS_PREWARM_PID` to the `cleanup()` trap at `:34`, and bound the `wait`. Given `PRESTART_NEXT_DEV=true` already skips it cleanly (per `logs/clean-run-20260905-124422.log`), deleting the pre-warm and defaulting to `PRESTART_NEXT_DEV=true` is the cheaper fix. **Kill PID 98557 before your next dev run.**

Deferred but worth a ticket: drop the unlistened `transcription-progress` emit (`worker.rs:283`); replace Rust's self-listener (`recording_commands.rs:301`) with a direct call; delete `lib_old_complex.rs`, `audio_v2/`, `core-old.rs`, `*.backup`; fix the stale `50ms` comment at `pipeline.rs:27` and the matching claim in `CLAUDE.md`.

---

# 4. QA repros

**R1 — Model-load blackout (N1).** Quit and relaunch the tester. Start recording and immediately begin speaking continuously. Stopwatch from the click to the first on-screen text. Then stop, and **without quitting**, start a second recording and repeat. In `clean-run-*.log`, compare timestamps for `Loading model:` → `✅ Model '<x>' loaded successfully` → the first `✅ Worker 0 transcribed:`. Expected today: several seconds on run 1, identical on run 2 (because stop unloaded it). After fix 1: run 2's gap ≈ 0.

**R2 — Unbounded utterance (N2).** Read a passage aloud for 60 seconds with no pause longer than ~300ms (read a dense paragraph fast). Watch for `VAD: Completed speech segment: <ms> duration`. Expected: one segment near 60000ms, and a blank transcript panel the whole time. Contrast: read the same passage with a deliberate 1s pause every 10s — segments appear steadily. If R2's second variant streams fine and the first does not, N2 is confirmed as the dominant streaming complaint.

**R3 — Startup lost segments (N6).** Start recording and speak a distinctive word ("banana") within the first 2 seconds, then stay silent 5s. Grep the log for `✅ Worker 0 transcribed: banana` and confirm it appears in Rust. Then check the on-screen panel and `~/Library/Application Support/com.meetnola.tester/logs/frontend-runtime.log` for `🎯 MAIN LISTENER: Received transcript update`. Rust-emitted-but-never-received = N6.

**R4 — Cross-recording ordering (N5).** Record → stop → record again in the same app session. In `frontend-runtime.log`, read the `sequence_id` on the second recording's first `🎯 MAIN LISTENER` line. Non-zero confirms N5. Then watch for `Processing transcript with sequence_id N, age: Xms` lines with no preceding sequential-drain — ordering is running on the timing heuristic, not on sequence.

**R5 — Stop latency attribution (N3).** Record 30s, stop, stopwatch to the meeting-details page. Then in `useRecordingStop.ts` note the logged `time_since_stop` and `total_time_since_stop` at `:235-247` — the delta to your stopwatch is the 4000+500+2000 hardcoded sleeps. Also confirm `Received transcription-complete event` **never** appears in any log (dead listener).

**R6 — Console bridge cost (N4).** Record 3 minutes of continuous speech. Count `[frontend]` lines in `clean-run-*.log`. Divide by the number of `✅ Worker 0 transcribed:` lines. Expect ≫ 5 forwarded logs (each = one serialized IPC round-trip) per transcript segment.

**R7 — Prewarm orphan (F4).** `lsof -nP -iTCP:3118 -sTCP:LISTEN` before and after `./clean_run.sh`. If a `next-server` survives script exit, F4 reproduced.

---

# 5. Ignore for now

- **`NUM_WORKERS = 1`** (`worker.rs:67`). Raising it reintroduces out-of-order emission and, because the frontend's ordering path is already broken (N5), would make things visibly worse. Revisit only after fix 6. Note the pool also holds the receiver mutex across `recv().await` (`worker.rs:112-116`), so it's not actually a parallel design.
- **Transcript re-sort and IndexedDB dual-write** in `TranscriptContext.tsx:255-281, 334-337`. Real, but the list is virtualized (C3) and the IndexedDB write is fire-and-forget. Not measurable next to N1/N3/N4.
- **`is_partial`** — dead field (C4). Cosmetic cleanup at best.
- **`audio/pipeline.rs:51-58` `static mut SAMPLE_COUNTER` with `unsafe`** — technically UB, practically harmless diagnostic counter. Ticket it, don't prioritize it.
- **`ProfessionalAudioMixer` doc drift** — `pipeline.rs:165-169` says "pre-scale system audio to 70%" and then does `sys * 1.0`; `CLAUDE.md` describes RMS-based ducking that no longer exists (`pipeline.rs:147` is a unit struct). Comment/doc debt only; it does not affect transcription, which reads the mixed signal either way.
- **The archived `backend/` FastAPI tier** — correctly out of scope, and nothing in the live path touches it.
