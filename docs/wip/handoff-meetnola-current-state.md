# Meetnola Current State Handoff

Last updated: 2026-03-09

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
