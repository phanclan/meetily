# Afterword preferences map

Inventory of real preference keys so toggles do not fight. The TypeScript
source of this table is `frontend/src/lib/preferencesMap.ts`. Update both
when adding a writer.

`/settings` is the settings shell (left rail already exists). Task modals
that remain: audio devices, transcription language, transcription-required
model selector, error alert, chunk-drop warning. The old Preferences overlay
on Home was removed; do not reopen it.

## Map

| Id | Keys | Backend | UI owner |
| --- | --- | --- | --- |
| call-detection | `meetily.callDetectionEnabled`; `set_call_detection_enabled` | localStorage + Rust runtime | `/settings` Recording; layout bootstrap via `callDetectionStore` |
| recording-preferences | `recording_preferences.json` `preferences` | Tauri store via `set_recording_preferences` | `/settings` Recording; leftover device modal writes the same `preferred_*` fields |
| recording-start-toast | `preferences.json` `show_recording_notification` | Tauri plugin-store | `/settings` Recording + in-app toast “Don’t show again” |
| os-notifications | `get/set_notification_settings` | Rust `notifications.json` | `/settings` General (`PreferenceSettings`) |
| analytics-consent | `analytics.json` `analyticsOptedIn` | Tauri plugin-store | `/settings` General |
| beta-flags | `localStorage` `betaFeatures` | JSON blob | `/settings` Beta |
| summary-language | `summaryLanguageDefault` / recents / per-meeting fallbacks | localStorage (+ SQLite metadata) | `/settings` AI Enhancement |
| transcript-model | `api_get/save_transcript_config` | Rust/SQLite | `/settings` Transcription; `modelSelector` modal is required-setup, same row |
| summary-model | `api_get/save_model_config` | Rust/SQLite | `/settings` AI Enhancement |
| transcript-language | `primaryLanguage`; `set_language_preference` | localStorage + Rust | leftover language modal (transcript panel) |
| confidence-indicator | `showConfidenceIndicator` | localStorage | leftover `modelSelector` footer |
| auto-summary | `isAutoSummary` | localStorage | **Meetily only** - `/settings` AI Enhancement, hidden on Afterword |

## Meetily-only preferences

`auto-summary` is the only entry that is not an Afterword preference. Only
`/meeting-details` reads `isAutoSummary`, and Afterword's saved-note surface is
`NoteWorkspace` (`/recording?saved=`), which enhances on demand through
`EnhanceNotesCta`. The switch in `SummaryModelSettings` is therefore hidden when
`isAfterword`, rather than left in `/settings` doing nothing.

The key and `ConfigContext.toggleIsAutoSummary` stay in the codebase for the
Meetily path. Do not wire auto-summary into `NoteWorkspace` to "make the toggle
work" - that is a product decision, not a wiring gap.

## Related, not the same key

Recording start has **two** channels:

1. In-app compliance toast — `show_recording_notification`
2. OS start/stop notifications — `notification_preferences.show_recording_started` / `show_recording_stopped`

Do not merge them in this pass. They look related in the UI and are stored in different backends.

Call detection localStorage vs Rust is a **sync pair** (persist vs runtime), now owned by `callDetectionStore`. Transcription language uses the same persist+Rust pattern via `ConfigContext`.

## Fights found

None that currently double-write the same key from two live settings UIs. The removed Preferences overlay was the duplicate summary-model / general-prefs shell. Device preferred-mics have two UIs (`RecordingSettings` and `deviceSettings` modal) but one backend.
