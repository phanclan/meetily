'use client';

import { useEffect, useRef, useState } from 'react';
import { meetnolaInvoke } from '@/meetnola/ipc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { exportSavedMeeting } from '@/lib/exportSavedMeeting';

export function MarkdownExportDialog({ meetingId, open, onOpenChange, beforeExport }: {
  meetingId: string; open: boolean; onOpenChange: (open: boolean) => void; beforeExport: () => Promise<void>;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exported, setExported] = useState('');
  const generation = useRef(0);
  const working = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    if (open) {
      setLoading(true); setError(''); setExported('');
      void meetnolaInvoke<string | null>('get_export_folder').then(value => {
        if (current === generation.current) setFolder(value);
      }).catch(reason => { if (current === generation.current) setError(String(reason)); })
        .finally(() => { if (current === generation.current) setLoading(false); });
    }
    return () => { generation.current++; };
  }, [open, meetingId]);

  const run = async (choose: boolean) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setExported('');
    const current = generation.current;
    try {
      if (choose) {
        const selected = await meetnolaInvoke<string | null>('choose_export_folder');
        if (selected && current === generation.current) setFolder(selected);
      } else {
        const path = await exportSavedMeeting(meetingId, beforeExport);
        if (current === generation.current) setExported(path);
      }
    } catch (reason) { if (current === generation.current) setError(String(reason)); }
    finally { working.current = false; if (current === generation.current) setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={value => { if (!working.current) onOpenChange(value); }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto" onCloseAutoFocus={event => {
      const target = document.querySelector<HTMLButtonElement>(`button[data-meeting-actions-id="${CSS.escape(meetingId)}"]`);
      if (target) { event.preventDefault(); target.focus(); }
    }}>
      <DialogHeader><DialogTitle>Export Markdown</DialogTitle><DialogDescription>
        Save enhanced notes, original written notes, and the full timestamped transcript in one file for Obsidian or another app.
      </DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm [overflow-wrap:anywhere]">
        <p className="font-medium">Export folder</p>
        <p className="text-stone-600" role="status">{loading ? 'Loading folder…' : folder || 'Choose a folder, including a folder inside your Obsidian vault.'}</p>
        <Button variant="outline" disabled={busy || loading} onClick={() => void run(true)}>{folder ? 'Change folder' : 'Choose folder'}</Button>
        <p className="text-xs text-stone-500">Exports use Documents until you choose a custom folder. Each export creates a new dated file. Export again after editing; files are not automatically synced.</p>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {exported && <div role="status" className="space-y-1"><p className="font-medium">Markdown exported</p><p className="text-stone-600">{exported}</p></div>}
      </div>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
        <Button disabled={busy || loading || !folder} onClick={() => void run(false)}>{busy ? 'Working…' : exported ? 'Export again' : 'Export Markdown'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
