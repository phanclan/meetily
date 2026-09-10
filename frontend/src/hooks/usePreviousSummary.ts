import { useEffect, useRef, useState } from 'react';
import { meetnolaInvoke } from '@/meetnola/ipc';
import type { Summary } from '@/types';

export interface PreviousSummary {
  versionId: string;
  savedAt: string;
  currentRevision: string;
  result: Summary;
}

export function usePreviousSummary({ meetingId, open, beforeRead, onRestored }: {
  meetingId: string; open: boolean;
  beforeRead: () => Promise<void>;
  onRestored: (result: Summary) => void;
}) {
  const key = JSON.stringify([meetingId, open]);
  const callbacks = useRef({ beforeRead, onRestored });
  callbacks.current = { beforeRead, onRestored };
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; loading: boolean; data: PreviousSummary | null; error: string }>({ key: '', loading: false, data: null, error: '' });
  const [restoring, setRestoring] = useState(false);
  const active = useRef<object | null>(null);
  const owner = useRef(key);
  owner.current = key;

  useEffect(() => {
    const token = {}; active.current = token;
    let cancelled = false;
    setRestoring(false);
    setState({ key, loading: open, data: null, error: '' });
    if (open) void (async () => {
      let saved = false;
      try {
        await callbacks.current.beforeRead();
        saved = true;
        if (cancelled || owner.current !== key) return;
        const data = await meetnolaInvoke<PreviousSummary | null>('get_previous_summary', { meetingId });
        if (!cancelled && owner.current === key) setState({ key, loading: false, data, error: '' });
      } catch (error) {
        if (!cancelled && owner.current === key) setState({ key, loading: false, data: null, error:
          !saved ? 'Could not save your current edits. Close this preview and retry saving.' :
          String(error).startsWith('Wait for enhancement') ? String(error) : 'Could not load the previous enhancement. Try Reload preview.' });
      } finally { if (active.current === token) active.current = null; }
    })();
    else active.current = null;
    return () => { cancelled = true; if (active.current === token) active.current = null; };
  }, [key, meetingId, open, attempt]);

  const restore = async () => {
    if (!open || state.key !== key || !state.data || active.current) return;
    const token = {}; active.current = token;
    setRestoring(true); setState(value => ({ ...value, error: '' }));
    try {
      const result = await meetnolaInvoke<Summary>('restore_previous_summary', {
        meetingId, currentRevision: state.data.currentRevision, versionId: state.data.versionId,
      });
      if (owner.current === key && active.current === token) callbacks.current.onRestored(result);
    } catch (error) {
      if (owner.current === key && active.current === token) setState(value => ({ ...value, error:
        String(error).startsWith('This note changed.') ? String(error) : 'Could not confirm the restore. Try Restore this version again.' }));
    } finally {
      if (active.current === token) { active.current = null; setRestoring(false); }
    }
  };
  useEffect(() => () => { active.current = null; owner.current = ''; }, []);
  return { ...(state.key === key ? state : { loading: open, data: null, error: '' }), restoring, restore,
    retry: () => { if (!active.current) setAttempt(value => value + 1); } };
}
