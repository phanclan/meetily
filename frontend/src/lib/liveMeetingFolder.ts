import { loadQuickNoteDraft } from '@/lib/quickNoteDraft';
import { folderFromSearch, isNoteWorkspaceRoute } from '@/lib/quickNoteRoute';

const pendingKey = 'meetnola.recording.note-folder';
const key = (id: string) => `meetnola.live-folder.${id}`;

export function currentRecordingFolder(): string | null {
  if (typeof window === 'undefined' || !isNoteWorkspaceRoute(window.location.pathname)) return null;
  // The route carries the folder a recording was started from; the draft is the fallback
  // for a session started before that folder reached storage.
  return folderFromSearch(window.location.search) || loadQuickNoteDraft().folderId;
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
