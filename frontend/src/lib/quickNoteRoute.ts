'use client';

const START_TOKEN_KEY = 'meetnola:consumed-recording-start';

function consumedStartToken(): number {
  if (typeof window === 'undefined') return 0;
  const stored = window.sessionStorage.getItem(START_TOKEN_KEY);
  const value = stored === null ? 0 : Number(stored);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Could not read recording start state. Start recording from the app controls.');
  return value;
}

/** A route is a one-time user intent, not a standing instruction to capture audio. */
export function consumeQuickNoteStartToken(token: string): boolean {
  if (typeof window === 'undefined' || !/^\d+$/.test(token)) return false;
  const value = Number(token);
  if (!Number.isSafeInteger(value) || value <= 0 || value <= consumedStartToken()) return false;
  // Commit before requesting capture. A reload must not replay a failed or pending start.
  window.sessionStorage.setItem(START_TOKEN_KEY, token);
  return true;
}

export function createQuickNotePath(folderId?: string | null) {
  // Keep explicit new intents usable even after the system clock moves backward.
  const token = Math.max(Date.now(), consumedStartToken() + 1);
  return `/quick-note?fresh=${token}${folderId ? `&folder=${encodeURIComponent(folderId)}` : ''}`;
}

export function createDraftNotePath(folderId?: string | null) {
  return `/quick-note${folderId ? `?folder=${encodeURIComponent(folderId)}` : ''}`;
}

export function createRecordingWorkspacePath(isRecording: boolean) {
  return isRecording ? '/quick-note' : createQuickNotePath();
}
