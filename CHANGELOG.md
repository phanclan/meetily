# Changelog

All notable changes to this project should be documented in this file.

## Unreleased

### Added
- Live meeting notes support during recording, including local note persistence and meeting details note display.
- Live meeting AI chat during active recordings.
- Call detection preference toggle in Settings, defaulting to disabled.
- Persistent dev-run logging in `frontend/logs/`.
- Frontend runtime error logging to the app data directory.
- Developer onboarding and build documentation in `docs/GETTING_STARTED.md` and expanded `docs/BUILDING.md`.
- `meetnola Tester` packaged build flavor with a separate bundle id, app-data folder, and isolated SQLite database for peer testing.
- Visible build identity in tester builds, including an in-app build badge and About / Settings version display.
- `Enhance notes` CTA for saved notes and meetings, using typed notes plus transcript context for AI-generated enhanced notes.

### Changed
- `frontend/clean_run.sh` now resolves paths from the script directory, performs tool preflight checks, logs each run to a file, and cleans `.next/` by default.
- `frontend/clean_run.sh` now rebuilds and installs the `llama-helper` sidecar more predictably.
- Call detection is now explicitly gated by a user setting instead of always being active at startup.
- Fresh installs now default to Groq for transcript + summary configuration, with local models treated as optional.
- Groq and OpenAI API keys are now shared between transcript and summary settings.
- `New note`, sidebar `Start Recording`, and call-detection entry now route into the same quick-note recording workflow.
- Saved quick notes and saved meeting details now use the same transcript-hidden, AI-composer-bottom, document-first interaction model.
- Saved notes now expose a top-right overflow menu for copy/open-folder/save/delete actions, bringing the stop screen closer to the reopened meeting screen.
- Homepage meetings are now grouped into `This week`, `Last week`, and `Older`, with all sessions visible in the browser instead of only a short implicit slice.
- Version bumped to `0.3.2` for the latest tester build.

### Fixed
- Prevented BlockNote from crashing when mounted with empty initial note content.
- Improved note-save behavior so pending edits are flushed on unmount/stop instead of being dropped by debounce timing.
- Moved meeting notes from the temporary live recording ID to the final persisted meeting ID after save.
- Fixed quick-note auto-restart after stop and aligned stop handling around structured stop results.
- Fixed several macOS system-audio issues around backend selection, stale backend persistence, selected-output handling, and packaged-app permission validation.
- Fixed transcript sidecar persistence so saved meeting folders no longer drift from the SQLite transcript state after save.
- Fixed homepage recent-meeting over-fetching caused by unstable context rebuild triggers.
- Fixed duplicate homepage hover tooltips by keeping the native tooltip only.
- Fixed notes-only meetings keeping generated timestamp titles by deriving a title from meaningful saved notes.
- Hardened the macOS build script so executable permissions are normalized on bundle binaries even when the DMG step fails afterward.

### Docs
- Split developer guidance into a getting-started flow and detailed build instructions.
- Added a macOS-first architecture audit and execution plan under `docs/`.
- Added ongoing implementation handoffs under `docs/wip/`, including `docs/wip/handoff-meetnola-current-state.md`.
