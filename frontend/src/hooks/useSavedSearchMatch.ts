import { useEffect, useState } from 'react';
import { meetnolaInvoke } from '@/meetnola/ipc';
import type { SavedMeetingMatch } from './useSavedMeetingSearch';

export type SavedSearchTarget = { kind: 'notes' | 'transcript'; sourceId: string; query: string };
type MatchState = { key: string; loading: boolean; match: SavedMeetingMatch | null; error: string | null };

export function useSavedSearchMatch(meetingId: string, target: SavedSearchTarget) {
  const { sourceId, kind, query } = target;
  const key = JSON.stringify([meetingId, sourceId, kind, query]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MatchState>({ key: '', loading: true, match: null, error: null });
  useEffect(() => {
    let cancelled = false;
    setState({ key, loading: true, match: null, error: null });
    meetnolaInvoke<SavedMeetingMatch | null>('get_saved_search_match', { meetingId, sourceId, kind, query })
      .then(match => { if (!cancelled) setState({ key, loading: false, match, error: null }); })
      .catch(error => { if (!cancelled) setState({ key, loading: false, match: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; };
  }, [key, meetingId, sourceId, kind, query, attempt]);
  return { ...(state.key === key ? state : { loading: true, match: null, error: null }), retry: () => setAttempt(value => value + 1) };
}
