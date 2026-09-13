/**
 * One post-stop owner: UI and tray only request native stop; this module plus
 * `RecordingPostProcessingProvider` run save / navigation / `onSaved`.
 *
 * Tray emits `recording-stop-complete`. The recording workspace calls
 * `requestRecordingPostStop` after `stop_recording` returns. Both paths share
 * the single `useRecordingStop` instance mounted by the provider.
 */

export type RecordingStopOptions = {
  autoNavigate?: boolean;
  showToast?: boolean;
  /** When set, append new segments to this meeting instead of creating a new one. */
  appendToMeetingId?: string;
  /** Index into the live transcript buffer where this resume session began. */
  resumeBaselineCount?: number;
  onSaved?: (meetingId: string) => Promise<void> | void;
};

type StopHandler = (
  complete: boolean,
  options?: RecordingStopOptions,
) => Promise<string | undefined>;

let stopHandler: StopHandler | null = null;
let pendingOptions: RecordingStopOptions = {};

export function registerRecordingStopHandler(handler: StopHandler | null) {
  stopHandler = handler;
}

export function registerRecordingStopOptions(options: RecordingStopOptions) {
  pendingOptions = { ...pendingOptions, ...options };
}

export function consumeRecordingStopOptions(): RecordingStopOptions {
  const options = pendingOptions;
  pendingOptions = {};
  return options;
}

export function clearRecordingStopOptions() {
  pendingOptions = {};
}

/**
 * Run the shared post-stop flow (save, navigation, onSaved).
 * `complete` matches native `stop_recording` `status === "complete"`.
 */
export async function requestRecordingPostStop(
  complete: boolean,
  options: RecordingStopOptions = {},
): Promise<string | undefined> {
  const merged = { ...consumeRecordingStopOptions(), ...options };
  if (!stopHandler) {
    console.error('[recordingStop] Post-stop orchestrator is not mounted');
    return undefined;
  }
  return stopHandler(complete, merged);
}
