import type { Block } from '@blocknote/core';

export { isLiveMeetingId, isLiveSessionId, isPersistedMeetingId } from '@/lib/recordingSessionIdentity';

// Storage key keeps the legacy `meetnola.` prefix so unsaved live notes written
// before the Afterword rename are still recoverable.
const key = (id: string) => `meetnola.live-notes.${id}`;

export function readLiveMeetingNotes(id: string): Block[] | null {
  const stored = localStorage.getItem(key(id));
  if (!stored) return null;
  const blocks: unknown = JSON.parse(stored);
  if (!Array.isArray(blocks)) throw new Error('Invalid saved live notes');
  return blocks as Block[];
}

export function writeLiveMeetingNotes(id: string, blocks: Block[]) {
  localStorage.setItem(key(id), JSON.stringify(blocks));
}

export function clearLiveMeetingNotes(id: string) {
  localStorage.removeItem(key(id));
}
