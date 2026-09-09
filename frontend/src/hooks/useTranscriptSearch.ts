import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface TranscriptSearchResult {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
}

export function useTranscriptSearch() {
  const [searchResults, setSearchResults] = useState<TranscriptSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchTranscripts = useCallback((query: string) => {
    const version = ++revision.current;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setSearchResults([]);
    setIsSearching(Boolean(query.trim()));
    if (!query.trim()) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      try {
        const results = await invoke<TranscriptSearchResult[]>('api_search_transcripts', { query: query.trim() });
        if (version === revision.current) setSearchResults(results);
      } catch (error) {
        if (version === revision.current) console.error('Error searching transcripts:', error);
      } finally {
        if (version === revision.current) setIsSearching(false);
      }
    }, 250);
  }, []);

  useEffect(() => () => {
    revision.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  return { searchResults, isSearching, searchTranscripts };
}
