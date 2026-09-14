import { migrateProductStorageKeys } from '@/lib/migrateProductStorageKeys';

export const CALL_DETECTION_STORAGE_KEY = 'afterword.callDetectionEnabled';

export function loadCallDetectionPreference(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  migrateProductStorageKeys();

  const stored = localStorage.getItem(CALL_DETECTION_STORAGE_KEY);
  if (stored === null) {
    // Default ON — persist so it sticks across restarts / Rust sync
    saveCallDetectionPreference(true);
    return true;
  }

  return stored === 'true';
}

export function saveCallDetectionPreference(enabled: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(CALL_DETECTION_STORAGE_KEY, String(enabled));
}
