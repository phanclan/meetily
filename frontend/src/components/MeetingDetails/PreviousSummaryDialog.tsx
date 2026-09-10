'use client';

import dynamic from 'next/dynamic';
import type { Block } from '@blocknote/core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AssistantMessage } from '@/components/AssistantMessage';
import { usePreviousSummary } from '@/hooks/usePreviousSummary';
import type { Summary } from '@/types';

const Editor = dynamic(() => import('@/components/BlockNoteEditor/Editor'), { ssr: false });

export function PreviousSummaryPreview({ result }: { result: Summary }) {
  const data = result as Record<string, unknown>;
  if (Array.isArray(data.summary_json)) return <Editor initialContent={data.summary_json as Block[]} editable={false} />;
  if (typeof data.markdown === 'string') return <AssistantMessage content={data.markdown} copyable={false} />;
  const legacy = data.MeetingNotes as { sections?: unknown[] } | undefined;
  const sections = legacy?.sections ?? Object.values(data);
  return <div className="space-y-4">{sections.map((section, index) => {
    const item = section as { title?: string; blocks?: { content?: string }[] } | null;
    return item && typeof item.title === 'string' && Array.isArray(item.blocks)
      ? <section key={index}><h3 className="font-medium">{item.title}</h3><ul className="list-disc pl-5">{item.blocks.map((block, i) => <li key={i}>{typeof block.content === 'string' ? block.content : ''}</li>)}</ul></section>
      : null;
  })}</div>;
}

export function PreviousSummaryDialog({ meetingId, open, onOpenChange, beforeRead, onRestored }: {
  meetingId: string; open: boolean; onOpenChange: (open: boolean) => void;
  beforeRead: () => Promise<void>; onRestored: (result: Summary) => void;
}) {
  const previous = usePreviousSummary({ meetingId, open, beforeRead, onRestored: result => { onRestored(result); onOpenChange(false); } });
  return <Dialog open={open} onOpenChange={value => { if (!previous.restoring) onOpenChange(value); }}>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl flex-col" onCloseAutoFocus={event => {
      const target = document.querySelector<HTMLButtonElement>(`button[data-meeting-actions-id="${CSS.escape(meetingId)}"]`);
      if (target) { event.preventDefault(); target.focus(); }
    }}>
      <DialogHeader><DialogTitle>Previous enhancement</DialogTitle><DialogDescription>
        Preview the version saved before the last replacement. Restoring keeps your current version here, so you can switch back.
      </DialogDescription></DialogHeader>
      {previous.loading && <p role="status" className="text-sm text-stone-500">Loading previous enhancement…</p>}
      {previous.error && <p role="alert" className="text-sm text-red-700">{previous.error} <button type="button" disabled={previous.restoring} onClick={previous.retry} className="underline">Reload preview</button></p>}
      {!previous.loading && !previous.error && !previous.data && <p className="text-sm text-stone-500">No previous enhancement yet. Your current version will be kept the next time enhancement replaces it.</p>}
      {previous.data && <>
        <p className="text-xs text-stone-500">Saved {new Date(previous.data.savedAt).toLocaleString()}</p>
        <div className="document-editor min-h-0 overflow-y-auto break-words py-2 [overflow-wrap:anywhere] [&_.bn-editor]:!px-0" aria-label="Previous enhancement preview">
          <PreviousSummaryPreview result={previous.data.result} />
        </div>
      </>}
      <DialogFooter><Button variant="outline" disabled={previous.restoring} onClick={() => onOpenChange(false)}>Close</Button>
        <Button disabled={!previous.data || previous.loading || previous.restoring} onClick={() => void previous.restore()}>{previous.restoring ? 'Restoring…' : 'Restore this version'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
