import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Serialize writes so a slower earlier title cannot overwrite the latest edit.
export function useMeetingTitleSave(meetingId: string | null) {
  const writes = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<{ meetingId: string; title: string } | null>(null);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  const save = useCallback((title: string) => {
    if (!meetingId) return Promise.resolve();
    const edit = { meetingId, title: title.trim() || 'New note' };
    pending.current = edit;
    setStatus('saving');
    const write = writes.current.catch(() => {}).then(async () => {
      await invoke('api_save_meeting_title', edit);
    });
    writes.current = write;
    return write.then(() => {
      if (pending.current === edit) {
        pending.current = null;
        setStatus('saved');
      }
    }, error => {
      if (pending.current === edit) setStatus('error');
      throw error;
    });
  }, [meetingId]);

  const flush = useCallback(async () => {
    try {
      await writes.current;
    } catch {
      if (pending.current?.meetingId === meetingId) {
        await save(pending.current.title);
      } else {
        throw new Error('The meeting title could not be saved.');
      }
    }
  }, [meetingId, save]);

  return { save, flush, status };
}
