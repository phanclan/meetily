/**
 * Inventory of Afterword preference keys and which UI owns each write.
 * This is documentation, not a runtime store. See
 * `docs/afterword-preferences-map.md`.
 *
 * Do not add a second writer for a key without updating this map.
 */

import type { ProductFlavor } from '@/flavor';

export type PreferenceUi =
  | '/settings general'
  | '/settings recording'
  | '/settings transcription'
  | '/settings AI enhancement'
  | '/settings beta'
  | 'modal:deviceSettings'
  | 'modal:languageSettings'
  | 'modal:modelSelector'
  | 'layout bootstrap'
  | 'in-app toast';

export type PreferenceEntry = {
  id: string;
  label: string;
  /** Storage keys / IPC names as they exist in code. */
  keys: readonly string[];
  backend: string;
  ui: readonly PreferenceUi[];
  /**
   * Which product exposes this preference. Omitted means both. `meetily` entries
   * are still in the codebase but their UI is hidden on Afterword, so the key
   * keeps whatever value it last had and nothing reads it.
   */
  flavor?: ProductFlavor;
  notes: string;
};

export const PREFERENCES = [
  {
    id: 'call-detection',
    label: 'Detect meetings',
    keys: [
      'localStorage:afterword.callDetectionEnabled',
      'ipc:plugin:afterword|set_call_detection_enabled',
    ],
    backend: 'localStorage (persist) + Rust meeting_detection (runtime)',
    ui: ['/settings recording', 'layout bootstrap'],
    notes:
      'Default ON. Writes go through callDetectionStore so layout sync, RecordingSettings, and the banner share one source. Dual-write is intentional, not two competing stores.',
  },
  {
    id: 'recording-preferences',
    label: 'Save audio, folder, preferred devices',
    keys: [
      'store:recording_preferences.json#preferences',
      'ipc:get_recording_preferences',
      'ipc:set_recording_preferences',
    ],
    backend: 'Tauri store recording_preferences.json via Rust',
    ui: ['/settings recording', 'modal:deviceSettings'],
    notes:
      'Canonical toggle/path UI is RecordingSettings. The leftover deviceSettings modal writes the same preferred_* fields through ConfigContext.setSelectedDevices. Same backend; do not add a third writer.',
  },
  {
    id: 'recording-start-toast',
    label: 'Recording start notification (in-app toast)',
    keys: ['store:preferences.json#show_recording_notification'],
    backend: 'Tauri plugin-store preferences.json',
    ui: ['/settings recording', 'in-app toast'],
    notes:
      'Compliance toast in recordingNotification.tsx. Distinct from OS recording notifications below. Toast “Don’t show again” writes this same key.',
  },
  {
    id: 'os-notifications',
    label: 'Notifications (start/end of meeting)',
    keys: [
      'ipc:get_notification_settings',
      'ipc:set_notification_settings',
      'file:notifications.json',
    ],
    backend: 'Rust notifications module → config_dir/meetily/notifications.json',
    ui: ['/settings general'],
    notes:
      'PreferenceSettings maps one switch onto notification_preferences.show_recording_started and show_recording_stopped via ConfigContext.updateNotificationSettings. Not the same key as show_recording_notification.',
  },
  {
    id: 'analytics-consent',
    label: 'Analytics',
    keys: [
      'store:analytics.json#analyticsOptedIn',
      'store:analytics.json#analyticsDefaultOffMigrationV1',
    ],
    backend: 'Tauri plugin-store analytics.json',
    ui: ['/settings general'],
    notes: 'AnalyticsConsentSwitch writes; AnalyticsProvider reads on startup. Default-off migration key is write-once.',
  },
  {
    id: 'beta-flags',
    label: 'Beta features',
    keys: ['localStorage:betaFeatures'],
    backend: 'localStorage JSON (src/types/betaFeatures.ts)',
    ui: ['/settings beta'],
    notes: 'ConfigContext.toggleBetaFeature is the only writer. Current flag: importAndRetranscribe.',
  },
  {
    id: 'summary-language',
    label: 'Summary language',
    keys: [
      'localStorage:summaryLanguageDefault',
      'localStorage:summaryLanguageRecents',
      'localStorage:summaryLanguageFallback:<meetingId>',
      'localStorage:detectedSummaryLanguageFallback:<meetingId>',
    ],
    backend: 'localStorage via summary-language-preferences.ts; per-meeting also SQLite metadata',
    ui: ['/settings AI enhancement'],
    notes:
      'Pinned default + recents are global. Fallback keys are meeting-scoped, not settings toggles. Summary generator also reads/writes recents.',
  },
  {
    id: 'transcript-model',
    label: 'Transcription provider/model',
    keys: ['ipc:api_get_transcript_config', 'ipc:api_save_transcript_config'],
    backend: 'Rust/SQLite transcript config',
    ui: ['/settings transcription', 'modal:modelSelector'],
    notes:
      'Canonical UI is /settings Transcription. modelSelector is the required-setup modal (Whisper/Parakeet missing), not a second preferences page. Both save the same DB row.',
  },
  {
    id: 'summary-model',
    label: 'AI enhancement / summary model',
    keys: ['ipc:api_get_model_config', 'ipc:api_save_model_config'],
    backend: 'Rust/SQLite model config',
    ui: ['/settings AI enhancement'],
    notes:
      'Canonical UI is SummaryModelSettings. The old Preferences overlay that duplicated provider/model selects was removed. Runtime save sites (onboarding, meeting-details) still call api_save_model_config when applying a model, not as a settings shell.',
  },
  {
    id: 'transcript-language',
    label: 'Transcription language',
    keys: ['localStorage:primaryLanguage', 'ipc:set_language_preference'],
    backend: 'localStorage (persist) + Rust in-memory for live capture',
    ui: ['modal:languageSettings'],
    notes:
      'Opened from the live transcript panel. ConfigContext.setSelectedLanguage writes both backends. Not on /settings today.',
  },
  {
    id: 'confidence-indicator',
    label: 'Show confidence indicators',
    keys: ['localStorage:showConfidenceIndicator'],
    backend: 'localStorage via ConfigContext.toggleConfidenceIndicator',
    ui: ['modal:modelSelector'],
    notes: 'Only exposed on the transcription-required modal footer. TranscriptView also reads the key.',
  },
  {
    id: 'auto-summary',
    label: 'Auto summary (Meetily only)',
    keys: ['localStorage:isAutoSummary'],
    backend: 'localStorage via ConfigContext.toggleIsAutoSummary',
    ui: ['/settings AI enhancement'],
    flavor: 'meetily',
    notes:
      'Only /meeting-details reads isAutoSummary. Afterword enhances on demand via EnhanceNotesCta in NoteWorkspace, so the switch is hidden in SummaryModelSettings on Afterword rather than sitting there inert. Do not wire it into NoteWorkspace without a product decision.',
  },
] as const satisfies readonly PreferenceEntry[];
