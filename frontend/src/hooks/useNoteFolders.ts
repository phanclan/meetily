import { useEffect, useState } from 'react';
import { meetnolaInvoke } from '@/meetnola/ipc';

export type NoteFolder = { id: string; name: string; noteCount: number };

export function useFolderRead<T>(command: string, args: Record<string, unknown>, enabled = true, revision = 0) {
  const argsJson = JSON.stringify(args);
  const key = `${command}:${argsJson}:${enabled}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string | null }>({ key: '', data: null, loading: enabled, error: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState(previous => ({ key, data: previous.key === key ? previous.data : null, loading: true, error: null }));
    meetnolaInvoke<T>(command, JSON.parse(argsJson))
      .then(data => { if (!cancelled) setState({ key, data, loading: false, error: null }); })
      .catch(error => { if (!cancelled) setState(previous => ({ ...previous, key, loading: false, error: error instanceof Error ? error.message : String(error) })); });
    return () => { cancelled = true; };
  }, [key, command, argsJson, enabled, revision, attempt]);
  return {
    ...(state.key === key ? state : { data: null, loading: enabled, error: null }),
    retry: () => setAttempt(value => value + 1),
    setData: (data: T) => setState(previous => previous.key === key ? { ...previous, data } : previous),
  };
}
