'use client';

import { FileText, Loader2 } from 'lucide-react';
import { useSavedMeetingSearch, type SavedMeetingMatch } from '@/hooks/useSavedMeetingSearch';

export function MeetingSearchResults({ query, folderId = null, onOpenMeeting }: { query: string; folderId?: string | null; onOpenMeeting: (id: string, match: SavedMeetingMatch) => void }) {
  const search = useSavedMeetingSearch(query, folderId);
  return <section aria-label="Search results" aria-busy={search.loading}>
    <p role="status" className="mb-3 text-xs text-stone-500">{search.loading && !search.results.length ? 'Searching saved notes…'
      : search.error && !search.results.length ? 'Search unavailable'
      : `${search.results.length}${search.hasMore ? '+' : ''} matching ${search.results.length === 1 ? 'note' : 'notes'}`}</p>
    <div className="divide-y divide-stone-100">
      {search.results.map(meeting => {
        const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(meeting.createdAt) ? `${meeting.createdAt}T12:00:00` : meeting.createdAt);
        const seconds = meeting.audioStartTime;
        const time = seconds != null && Number.isFinite(seconds) && seconds >= 0 ? ` · ${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}` : '';
        return <button key={meeting.meetingId} type="button" onClick={() => onOpenMeeting(meeting.meetingId, meeting)} className="flex w-full min-w-0 gap-3 rounded-lg px-2 py-4 text-left hover:bg-stone-100/50 focus-visible:outline-stone-400">
          <FileText aria-hidden="true" className="mt-0.5 h-8 w-8 shrink-0 rounded-md bg-stone-100 p-2 text-stone-500" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-stone-800">{meeting.title}</span>
            <span className="mt-1 block text-xs text-stone-500">{meeting.kind === 'notes' ? 'Written notes' : meeting.kind === 'transcript' ? `Transcript${time}` : 'Title match'}{Number.isFinite(date.getTime()) ? ` · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>
            {meeting.text && <span className="mt-2 line-clamp-3 break-words text-sm leading-6 text-stone-600 [overflow-wrap:anywhere]">{meeting.text}</span>}
          </span>
        </button>;
      })}
    </div>
    {search.error ? <div role="alert" className="mt-3 rounded-lg border border-stone-200 p-4 text-sm"><p>{search.error}</p><button type="button" onClick={() => void search.retry()} className="mt-2 underline">Retry search</button></div>
      : !search.loading && !search.results.length ? <p className="py-8 text-center text-sm text-stone-500">No matching notes. Try another name or topic.</p> : null}
    {search.loading && <Loader2 aria-hidden="true" className="mx-auto my-3 h-4 w-4 animate-spin text-stone-500" />}
    {search.hasMore && !search.error && <button type="button" disabled={search.loading} onClick={() => void search.loadMore()} className="mt-3 w-full rounded-lg border border-stone-200 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50">{search.loading ? 'Loading…' : 'Load more matches'}</button>}
  </section>;
}
