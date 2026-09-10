'use client';

import { useSavedSearchMatch, type SavedSearchTarget } from '@/hooks/useSavedSearchMatch';
import { SavedTranscriptRows } from './SavedTranscriptRows';

export function SearchResultSource({ meetingId, target, onShowAll }: {
  meetingId: string; target: SavedSearchTarget; onShowAll: () => void;
}) {
  const source = useSavedSearchMatch(meetingId, target);
  return <section aria-label="Matching source" aria-busy={source.loading} className="mx-auto max-w-4xl">
    <h3 tabIndex={-1} data-search-match-heading className="mb-2 text-sm font-medium text-stone-900 outline-none">Search match</h3>
    <p className="mb-5 break-words text-xs leading-5 text-stone-500 [overflow-wrap:anywhere]">Excerpt matching “{target.query}” in the current original.</p>
    {source.loading ? <p role="status" className="text-sm text-stone-500">Loading the matching passage…</p>
      : source.error ? <div role="alert" className="text-sm text-stone-600"><p>Could not load the matching passage.</p><button type="button" onClick={source.retry} className="mt-2 underline">Retry passage</button></div>
      : source.match ? target.kind === 'transcript'
        ? <SavedTranscriptRows transcripts={[{ id: target.sourceId, text: source.match.text, timestamp: '', audio_start_time: source.match.audioStartTime ?? undefined }]} />
        : <p className="whitespace-pre-wrap break-words text-sm leading-7 text-stone-700 [overflow-wrap:anywhere]">{source.match.text}</p>
      : <p role="status" className="text-sm leading-6 text-stone-500">This passage no longer matches the search. It may have been edited or removed.</p>}
    <button type="button" onClick={onShowAll} className="mt-6 rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-stone-400">
      {target.kind === 'notes' ? 'Show all written notes' : 'Show full transcript'}
    </button>
  </section>;
}
