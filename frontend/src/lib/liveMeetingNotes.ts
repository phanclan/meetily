import type { Block } from '@blocknote/core';
import { migrateProductStorageKeys } from '@/lib/migrateProductStorageKeys';

export { isLiveMeetingId, isLiveSessionId, isPersistedMeetingId } from '@/lib/recordingSessionIdentity';

const key = (id: string) => `afterword.live-notes.${id}`;

function withMigratedStorage<T>(read: () => T): T {
  if (typeof window !== 'undefined') migrateProductStorageKeys();
  return read();
}

export function readLiveMeetingNotes(id: string): Block[] | null {
  return withMigratedStorage(() => {
    const stored = localStorage.getItem(key(id));
    if (!stored) return null;
    const blocks: unknown = JSON.parse(stored);
    if (!Array.isArray(blocks)) throw new Error('Invalid saved live notes');
    return blocks as Block[];
  });
}

export function writeLiveMeetingNotes(id: string, blocks: Block[]) {
  withMigratedStorage(() => {
    localStorage.setItem(key(id), JSON.stringify(blocks));
  });
}

export function clearLiveMeetingNotes(id: string) {
  withMigratedStorage(() => {
    localStorage.removeItem(key(id));
  });
}
