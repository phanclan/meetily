# Meetnola Current State Handoff

Last updated: 2026-09-05

## Quality fixes (2026-09-05)

- Code commit `32fb2ab` on `codex/meetnola-quality-fixes` addresses the seven review findings: checkpoint retention, Unicode-safe truncation, idempotent saves, editor clearing, saved-title persistence, accurate **New recording** behavior, and notes-only enhancement.
- Packaged tester build `20260905-32fb2ab` replaces the earlier bundle at the recovery worktree's app path. Local `main` was fast-forwarded through `3aee9b4`, which also refreshes Home's meeting list and finishes pending note/title saves before returning Home. Nothing was pushed.
- Passed: TypeScript, 16 frontend regression checks, 3 Rust tests using Unicode inputs and isolated SQLite databases, markdown/onboarding checks, production frontend/native builds, and ad-hoc signature verification. Dependencies were synchronized to the existing lockfile.
- Browser verification used the actual application editor: **Clear** emptied its visible document and stored state; subsequent typing did not restore old text.
- Earlier native retesting waited inside CoreAudio during CPAL input-device discovery. After the user's audio approval, two dev recordings started and stopped successfully. Native **Clear**, replacement notes, post-stop title edits, immediate Home navigation, and reopening passed. Synthetic audio produced two saved transcript segments; the transcript and a post-stop note edit survived reopening. TypeScript and all 16 frontend regression checks passed again after the Home fix.
- Synthetic evidence remains as **Meetnola dev quality verified** (notes only) and **Meetnola dev audio verified** (two transcript segments). No test records were deleted.
- Groq returned `expired_api_key`; the user then selected local Qwen enhancement. The tester now uses Ollama at its default local endpoint with the already installed `qwen3.6:35b-mlx` model (NVFP4, safetensors; Ollama 0.33.1). Notes-only enhancement succeeded and survived reopening, producing a summary, decision, and action item. Its generated title is **Review of Synthetic Quality Check and Parakeet Model Decisions** (formerly **Meetnola dev quality verified**). Credentials were not inspected or changed. Local Parakeet remains selected for transcription.
- The running development app is `/private/tmp/meetnola Dev.app`, a temporary ad-hoc-signed wrapper around the debug executable with the tester bundle ID. It loads the frontend hot-reload server on port 3118. Its native build badge is `20260905-1244-4957e34`; frontend code includes `3aee9b4`. This session uses a standalone Next dev server, so Rust changes require rebuilding and relaunching the native app. The packaged release bundle does not include the final Home refresh change.

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
