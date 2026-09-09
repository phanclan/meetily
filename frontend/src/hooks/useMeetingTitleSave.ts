import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createWriteQueue } from '@/lib/pendingWrites';

// Serialize writes so a slower earlier title cannot overwrite the latest edit.
export function useMeetingTitleSave(meetingId: string | null) {
  const writes = createWriteQueue(meetingId ? `title:${meetingId}` : undefined);
  const pending = useRef<{ meetingId: string; title: string } | null>(null);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  const save = useCallback((title: string) => {
    if (!meetingId) return Promise.resolve();
    const edit = { meetingId, title: title.trim() || 'New note' };
    pending.current = edit;
    setStatus('saving');
    return writes.enqueue(async () => {
      try {
        await invoke('api_save_meeting_title', edit);
        if (pending.current === edit) {
          pending.current = null;
          setStatus('saved');
        }
      } catch (error) {
        if (pending.current === edit) setStatus('error');
        throw error;
      }
    });
  }, [meetingId, writes]);

  const flush = useCallback(async () => {
    await writes.flush();
  }, [writes]);

  return { save, flush, status };
}
