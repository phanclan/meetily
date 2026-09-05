import type { Transcript } from '@/types';

function formatTranscriptTime(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--';
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

/** Render saved API transcripts using recording-relative time, not wall-clock time. */
export function SavedTranscriptRows({ transcripts, query = '' }: { transcripts: Transcript[]; query?: string }) {
  if (transcripts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm leading-6 text-stone-500">
        No transcript segments were captured for this meeting.
      </div>
    );
  }

  return transcripts.map((item) => (
    <div
      key={item.id}
      className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-b border-stone-100 py-3"
    >
      <div className="pt-1 text-xs tabular-nums text-stone-500">
        {formatTranscriptTime(item.audio_start_time)}
      </div>
      <p className="text-sm leading-7 text-stone-700">{query
        ? item.text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')).map((part, index) =>
            index % 2 === 1 ? <mark key={index} className="rounded-sm bg-amber-100 text-stone-900">{part}</mark> : part)
        : item.text}</p>
    </div>
  ));
}
