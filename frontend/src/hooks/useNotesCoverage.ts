import { useEffect, useRef, useState } from 'react';
import { cancelLiveQuery, liveQuery, prepareLiveQuery } from '@/afterword/ipc';

export interface NotesCoverageSnapshot { notes: string; draft: string }
export interface NotesCoverageFinding { explanation: string; evidence: { source: string; quote: string }[] }

/** A review owns an immutable snapshot; closing or changing meetings cancels it. */
export function useNotesCoverage(meetingId: string, open: boolean, readSnapshot: () => Promise<NotesCoverageSnapshot>) {
  const reader = useRef(readSnapshot);
  reader.current = readSnapshot;
  const owner = useRef('');
  const key = JSON.stringify([meetingId, open]);
  owner.current = key;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string; loading: boolean; error: string; notes: string; findings: NotesCoverageFinding[] | null;
  }>({ key: '', loading: false, error: '', notes: '', findings: null });

  useEffect(() => {
    let cancelled = false;
    let requestId: string | null = null;
    setState({ key, loading: open, error: '', notes: '', findings: null });
    if (open) void (async () => {
      try {
        const snapshot = await reader.current();
        if (cancelled || owner.current !== key) return;
        if (!snapshot.notes.trim() || !snapshot.draft.trim()) throw new Error('Add written notes and an enhancement before reviewing coverage.');
        setState(value => ({ ...value, notes: snapshot.notes }));
        requestId = await prepareLiveQuery();
        if (cancelled || owner.current !== key) return;
        const response = await liveQuery({ requestId, userMessage: '', transcriptContext: '', notesReview: snapshot });
        if (cancelled || owner.current !== key) return;
        const result = JSON.parse(response) as { findings: NotesCoverageFinding[] };
        if (!Array.isArray(result.findings)) throw new Error('Could not read the coverage review. Try again.');
        setState({ key, loading: false, error: '', notes: snapshot.notes, findings: result.findings });
      } catch (error) {
        if (!cancelled && owner.current === key) setState(value => ({ ...value, loading: false, error: error instanceof Error ? error.message : String(error) }));
      } finally {
        if (requestId) void cancelLiveQuery(requestId).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
      if (requestId) void cancelLiveQuery(requestId).catch(() => {});
    };
  }, [key, open, attempt]);

  return { ...(state.key === key ? state : { loading: open, error: '', notes: '', findings: null }),
    retry: () => { if (!state.loading) setAttempt(value => value + 1); } };
}
