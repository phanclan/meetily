export const CALL_DETECTION_STORAGE_KEY = 'meetily.callDetectionEnabled';

export function loadCallDetectionPreference(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return localStorage.getItem(CALL_DETECTION_STORAGE_KEY) === 'true';
}

export function saveCallDetectionPreference(enabled: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(CALL_DETECTION_STORAGE_KEY, String(enabled));
}
