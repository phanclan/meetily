import { useCallback, useEffect, useRef, useState } from 'react';
import { meetnolaInvoke } from '@/meetnola/ipc';

export interface SavedMeetingMatch {
  meetingId: string;
  title: string;
  createdAt: string;
  kind: 'notes' | 'transcript' | 'title';
  sourceId?: string | null;
  audioStartTime: number | null;
  text: string;
}
type SearchPage = { meetings: SavedMeetingMatch[]; hasMore: boolean };
type SearchState = { query: string; folderId: string | null; results: SavedMeetingMatch[]; loading: boolean; hasMore: boolean; error: string | null };

export function useSavedMeetingSearch(query: string, folderId: string | null = null) {
  const [state, setState] = useState<SearchState>({ query: '', folderId: null, results: [], loading: false, hasMore: false, error: null });
  const revision = useRef(0);
  const identity = JSON.stringify([query, folderId]);
  const currentQuery = useRef(identity);
  currentQuery.current = identity;
  const request = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const version = ++revision.current;
    let busy = false, offset = 0;
    const current = () => revision.current === version && currentQuery.current === identity;
    setState({ query, folderId, results: [], loading: Boolean(query), hasMore: false, error: null });
    const load = async () => {
      if (busy || !query || !current()) return;
      busy = true;
      setState(previous => ({ ...previous, loading: true, error: null }));
      try {
        const page = await meetnolaInvoke<SearchPage>('search_saved_meetings', { query, offset, folderId });
        if (!current()) return;
        offset += page.meetings.length;
        setState(previous => ({ query, folderId, results: [...new Map([...previous.results, ...page.meetings].map(item => [item.meetingId, item])).values()],
          loading: false, hasMore: page.hasMore, error: null }));
      } catch (error) {
        if (current()) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
      } finally { busy = false; }
    };
    request.current = load;
    const timer = query ? setTimeout(() => { void load(); }, 250) : null;
    return () => { ++revision.current; request.current = null; if (timer !== null) clearTimeout(timer); };
  }, [query, folderId, identity]);

  const loadMore = useCallback(() => request.current?.(), []);
  return { ...(state.query === query && state.folderId === folderId ? state : { query, results: [], loading: Boolean(query), hasMore: false, error: null }), loadMore, retry: loadMore };
}
