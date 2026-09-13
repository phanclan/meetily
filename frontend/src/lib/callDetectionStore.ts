import { listen } from '@tauri-apps/api/event';
import { setCallDetectionEnabled } from '@/afterword/ipc';
import {
  CALL_DETECTION_STORAGE_KEY,
  loadCallDetectionPreference,
  saveCallDetectionPreference,
} from '@/lib/callDetectionSettings';
import {
  type CallDetectionAnnouncement,
  announcementAfterRecordStop,
} from '@/lib/callDetectionCopy';
import { safelyUnlisten } from '@/lib/tauriEvents';

export type CallDetectionState = {
  enabled: boolean;
  lastDetected: string | null;
  dismissed: boolean;
  announcement: CallDetectionAnnouncement;
  appWhenRecordingStarted: string | null;
};

const listeners = new Set<() => void>();

const serverSnapshot: CallDetectionState = {
  enabled: true,
  lastDetected: null,
  dismissed: false,
  announcement: 'detected',
  appWhenRecordingStarted: null,
};

let state: CallDetectionState = { ...serverSnapshot };
let hydrated = false;
let started = false;
let unlistenDetected: (() => void) | undefined;
let unlistenEnded: (() => void) | undefined;

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<CallDetectionState>) {
  state = { ...state, ...patch };
  emit();
}

function hydrateEnabled() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  state = { ...state, enabled: loadCallDetectionPreference() };
}

export function subscribeCallDetection(listener: () => void) {
  hydrateEnabled();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCallDetectionState(): CallDetectionState {
  return state;
}

export function getServerCallDetectionState(): CallDetectionState {
  return serverSnapshot;
}

export async function setCallDetectionEnabledPref(enabled: boolean) {
  hydrateEnabled();
  const previous = state.enabled;
  saveCallDetectionPreference(enabled);
  setState(
    enabled
      ? { enabled }
      : { enabled, lastDetected: null, dismissed: false, announcement: 'detected', appWhenRecordingStarted: null },
  );
  try {
    await setCallDetectionEnabled(enabled);
  } catch (error) {
    saveCallDetectionPreference(previous);
    setState({ enabled: previous });
    throw error;
  }
}

export async function syncCallDetectionEnabledToNative() {
  hydrateEnabled();
  if (typeof window !== 'undefined' && localStorage.getItem(CALL_DETECTION_STORAGE_KEY) === null) {
    saveCallDetectionPreference(true);
  }
  const enabled = loadCallDetectionPreference();
  setState({ enabled });
  await setCallDetectionEnabled(enabled);
}

export function applyCallDetected(appName: string) {
  setState({
    lastDetected: appName,
    dismissed: false,
    announcement: 'detected',
  });
}

export function applyCallEnded() {
  setState({
    lastDetected: null,
    dismissed: false,
    announcement: 'detected',
    appWhenRecordingStarted: null,
  });
}

export function dismissCallDetection() {
  setState({ dismissed: true });
}

/** Keep last-detected; switch copy so Stop is not a fresh nudge. */
export function noteCallDetectionRecordingStarted() {
  if (!state.lastDetected) return;
  setState({
    appWhenRecordingStarted: state.lastDetected,
    announcement: announcementAfterRecordStop({
      appStillPresent: state.lastDetected,
      appWhenRecordingStarted: state.lastDetected,
    }),
  });
}

export async function bootstrapCallDetection() {
  await syncCallDetectionEnabledToNative();
  if (started) return;
  started = true;
  try {
    const detected = await listen<{ app_name: string }>('call-detected', event => {
      applyCallDetected(event.payload.app_name);
    });
    const ended = await listen('call-ended', () => {
      applyCallEnded();
    });
    if (!started) {
      safelyUnlisten(detected, 'call-detected');
      safelyUnlisten(ended, 'call-ended');
      return;
    }
    unlistenDetected = detected;
    unlistenEnded = ended;
  } catch (error) {
    started = false;
    throw error;
  }
}

export function teardownCallDetection() {
  started = false;
  safelyUnlisten(unlistenDetected, 'call-detected');
  safelyUnlisten(unlistenEnded, 'call-ended');
  unlistenDetected = undefined;
  unlistenEnded = undefined;
}
