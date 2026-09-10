import { loadQuickNoteDraft } from '@/lib/quickNoteDraft';

const pendingKey = 'meetnola.recording.note-folder';
const key = (id: string) => `meetnola.live-folder.${id}`;

export function currentRecordingFolder(): string | null {
  return typeof window !== 'undefined' && window.location.pathname === '/quick-note'
    ? loadQuickNoteDraft().folderId
    : null;
}

export function prepareRecordingFolder(folderId: string | null) {
  if (folderId) sessionStorage.setItem(pendingKey, folderId);
  else sessionStorage.removeItem(pendingKey);
}

// Bind synchronously before the editor can clear its draft or metadata awaits I/O.
export function bindRecordingFolder(liveId: string) {
  const folderId = sessionStorage.getItem(pendingKey);
  if (folderId) localStorage.setItem(key(liveId), folderId);
  else localStorage.removeItem(key(liveId));
  sessionStorage.removeItem(pendingKey);
}

export function readLiveMeetingFolder(liveId: string): string | null {
  return localStorage.getItem(key(liveId));
}

export function clearLiveMeetingFolder(liveId: string) {
  localStorage.removeItem(key(liveId));
}

export async function saveLiveMeetingFolder(liveId: string | null, meetingId: string) {
  const folderId = liveId ? readLiveMeetingFolder(liveId) : null;
  if (folderId) {
    const { meetnolaInvoke } = await import('@/meetnola/ipc');
    await meetnolaInvoke('set_meeting_note_folder', { meetingId, folderId, included: true });
  }
  return folderId;
}
