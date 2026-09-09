'use client';

import { useEffect, useState } from 'react';
import type { Transcript } from '@/types';
import { storageService } from '@/services/storageService';
import { SavedTranscriptRows } from './SavedTranscriptRows';

export function SearchableTranscript({ meetingId, transcripts, hasMore, autoFocus = true }: {
  meetingId: string; transcripts: Transcript[]; hasMore: boolean; autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [complete, setComplete] = useState<Transcript[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const searching = Boolean(query.trim());

  // The page remains paginated; only an active search loads the complete transcript.
  useEffect(() => {
    let cancelled = false;
    setComplete(null);
    setError(false);
    if (searching && hasMore) {
      storageService.getMeeting(meetingId).then(meeting => {
        if (!cancelled) setComplete(meeting.transcripts);
      }).catch(() => { if (!cancelled) setError(true); });
    }
    return () => { cancelled = true; };
  }, [meetingId, transcripts, searching, hasMore, attempt]);

  const pending = searching && hasMore && complete === null && !error;
  const source = complete ?? transcripts;
  const matches = source.filter(item => item.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input autoFocus={autoFocus} type="search" aria-label="Search transcript" placeholder="Find a word or phrase"
          value={query} onChange={event => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
        {query && <button type="button" onClick={() => setQuery('')} className="text-sm text-stone-600 underline">Clear search</button>}
      </div>
      {searching && <p role="status" className="mb-3 text-xs text-stone-500">
        {pending ? 'Searching the complete transcript…' : error ? 'Could not search the complete transcript.' : `${matches.length} matching segment${matches.length === 1 ? '' : 's'}`}
      </p>}
      {error && <button type="button" onClick={() => setAttempt(value => value + 1)} className="mb-4 text-sm underline">Retry search</button>}
      {!pending && !error && (searching && matches.length === 0
        ? <p className="py-8 text-sm text-stone-500">No matches. Try another word or clear the search.</p>
        : <SavedTranscriptRows transcripts={searching ? matches : transcripts} query={query.trim()} />)}
    </div>
  );
}
