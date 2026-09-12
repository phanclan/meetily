'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useFolderRead } from '@/hooks/useNoteFolders';
import { afterwordInvoke } from '@/afterword/ipc';

type TrashedNote = { id: string; title: string; trashedAt: string };
type TrashPage = { meetings: TrashedNote[]; hasMore: boolean };

export function TrashDialog({ open, onOpenChange, onChanged }: {
  open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TrashedNote | null>(null);
  const page = useFolderRead<TrashPage>('list_trashed_meetings', { offset }, open);
  useEffect(() => { if (!open) { setOffset(0); setDeleting(null); setError(null); } }, [open]);
  useEffect(() => {
    if (open && !page.loading && page.data && !page.data.meetings.length && offset > 0) setOffset(value => Math.max(0, value - 50));
  }, [open, page.loading, page.data, offset]);

  const change = async (note: TrashedNote, permanently: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      await afterwordInvoke(permanently ? 'delete_trashed_meeting' : 'restore_trashed_meeting', { meetingId: note.id });
      setDeleting(null);
      page.retry();
      onChanged();
      toast.success(permanently ? 'Note permanently deleted' : 'Note restored');
      if (!permanently) requestAnimationFrame(() => doneRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { busyRef.current = false; setBusy(false); }
  };

  return <>
    <Dialog open={open} onOpenChange={next => { if (!busyRef.current) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden" onCloseAutoFocus={event => {
        event.preventDefault();
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-trash-trigger]')?.focus());
      }}>
        <DialogHeader><DialogTitle>Trash</DialogTitle><DialogDescription>Restore notes to their original folders. Notes stay here until you choose to delete them permanently.</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {page.loading && <p role="status" className="py-4 text-sm text-stone-500">Loading Trash…</p>}
          {page.error && <div role="alert" className="py-4 text-sm text-stone-600">Could not load Trash. <Button variant="ghost" size="sm" onClick={page.retry}>Retry</Button></div>}
          {!page.loading && !page.error && !page.data?.meetings.length && <p className="py-8 text-center text-sm text-stone-500">Trash is empty</p>}
          {!page.loading && !page.error && page.data?.meetings.map(note => <div key={note.id} className="flex flex-col gap-3 border-b border-stone-100 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-stone-900 [overflow-wrap:anywhere]">{note.title}</p><p className="mt-1 text-xs text-stone-500">Moved to Trash {new Date(note.trashedAt).toLocaleDateString()}</p></div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Button variant="ghost" size="sm" disabled={busy} aria-label={`Restore ${note.title}`} onClick={() => void change(note, false)}><RotateCcw />Restore</Button>
              <Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete ${note.title} permanently`} className="text-red-700" onClick={event => { deleteTriggerRef.current = event.currentTarget; setError(null); setDeleting(note); }}><Trash2 />Delete permanently</Button>
            </div>
          </div>)}
        </div>
        {error && !deleting && <p role="alert" className="text-sm text-red-700">{error} Try the action again.</p>}
        <DialogFooter className="flex-row flex-wrap items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-2"><Button variant="ghost" size="sm" disabled={busy || page.loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous</Button><span className="text-xs text-stone-500">Page {offset / 50 + 1}</span><Button variant="ghost" size="sm" disabled={busy || page.loading || !page.data?.hasMore} onClick={() => setOffset(value => value + 50)}>Next</Button></div>
          <Button ref={doneRef} variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={next => { if (!next && !busyRef.current) { setDeleting(null); setError(null); } }}>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto" onCloseAutoFocus={event => {
        event.preventDefault();
        requestAnimationFrame(() => (deleteTriggerRef.current?.isConnected ? deleteTriggerRef.current : doneRef.current)?.focus());
      }}>
        <DialogHeader><DialogTitle>Delete note permanently?</DialogTitle><DialogDescription className="break-words [overflow-wrap:anywhere]">“{deleting?.title}” and its written notes, transcript, and enhancements cannot be restored after this. Saved library answers that used this note will also be removed. Recording files on disk are kept.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-red-700">{error} Try deleting again.</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => { if (deleting) void change(deleting, true); }}>{busy ? 'Deleting…' : 'Delete permanently'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
