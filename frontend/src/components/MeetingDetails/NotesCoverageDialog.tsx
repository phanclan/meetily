'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNotesCoverage, type NotesCoverageSnapshot } from '@/hooks/useNotesCoverage';

export function NotesCoverageDialog({ meetingId, open, onOpenChange, readSnapshot }: {
  meetingId: string; open: boolean; onOpenChange: (open: boolean) => void;
  readSnapshot: () => Promise<NotesCoverageSnapshot>;
}) {
  const review = useNotesCoverage(meetingId, open, readSnapshot);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl flex-col" onCloseAutoFocus={event => {
      const target = document.querySelector<HTMLButtonElement>(`button[data-meeting-actions-id="${CSS.escape(meetingId)}"]`);
      if (target) { event.preventDefault(); target.focus(); }
    }}>
      <DialogHeader><DialogTitle>Review written-note coverage</DialogTitle><DialogDescription>
        Compare every written passage with the enhancement. You decide which details belong; your documents stay unchanged.
      </DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto break-words [overflow-wrap:anywhere]">
        {review.loading && <p role="status" className="text-sm text-stone-500">Comparing your written notes with the current enhancement…</p>}
        {review.error && <p role="alert" className="text-sm text-red-700">{review.error}</p>}
        {review.findings?.length === 0 && <p role="status" className="text-sm">No possible omissions identified. This check can still miss details.</p>}
        {Boolean(review.findings?.length) && <>
          <p className="text-xs text-stone-500">Passages that may not be fully represented, including metadata. Suggestions can be wrong; compare before editing.</p>
          <ol className="space-y-4">{review.findings!.map((finding, index) => <li key={index} className="space-y-2 text-sm">
            <p className="font-medium">{finding.explanation}</p>
            {finding.evidence.map((item, evidenceIndex) => <blockquote key={evidenceIndex} className="whitespace-pre-wrap border-l-2 border-stone-200 pl-3 text-stone-600">{item.quote}</blockquote>)}
          </li>)}</ol>
        </>}
        {review.notes && <details className="text-sm"><summary className="cursor-pointer text-stone-600">Written notes used for this review</summary>
          <p className="mt-3 whitespace-pre-wrap">{review.notes}</p>
        </details>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{review.loading ? 'Cancel review' : 'Close'}</Button>
        {!review.loading && <Button variant="outline" onClick={review.retry}>{review.error ? 'Try again' : 'Review again'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
