'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Folder, Plus } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { meetnolaInvoke } from '@/meetnola/ipc';
import { useFolderRead, type NoteFolder } from '@/hooks/useNoteFolders';

export function NoteFolderDialog({ open, onOpenChange, folder, onCreated, returnFocusRef }: {
  open: boolean; onOpenChange: (open: boolean) => void; folder?: NoteFolder; onCreated?: (folder: NoteFolder) => void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const { refreshNoteFolders } = useSidebar();
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (open) { setName(folder?.name ?? ''); setError(''); } }, [open, folder?.id, folder?.name]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      if (folder) await meetnolaInvoke('rename_note_folder', { folderId: folder.id, name });
      else {
        const created = await meetnolaInvoke<NoteFolder>('create_note_folder', { name, meetingId: null });
        onCreated?.(created);
      }
      refreshNoteFolders(); onOpenChange(false);
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => {
    if (returnFocusRef?.current?.isConnected) { event.preventDefault(); returnFocusRef.current.focus(); }
  }}>
    <DialogHeader><DialogTitle>{folder ? 'Rename folder' : 'New folder'}</DialogTitle><DialogDescription>Organize saved notes locally on this Mac.</DialogDescription></DialogHeader>
    <form onSubmit={save} className="space-y-4">
      <label className="block text-sm">Folder name<input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={busy} className="mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2" /></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <DialogFooter><Button variant="outline" type="button" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : folder ? 'Save name' : 'Create folder'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export function NoteFolderSidebar() {
  const { noteFolders } = useSidebar();
  const router = useRouter(), params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  return <section aria-label="Note folders" className="mb-3 shrink-0 px-2">
    <div className="flex items-center justify-between px-2"><h2 className="text-xs font-medium text-stone-500">Folders</h2><button ref={createTriggerRef} type="button" onClick={() => setCreating(true)} aria-label="New folder" className="rounded p-1.5 text-stone-500 hover:bg-stone-100"><Plus className="h-3.5 w-3.5" /></button></div>
    {noteFolders.loading && !noteFolders.data && <p role="status" className="px-2 py-1 text-xs text-stone-500">Loading folders…</p>}
    {noteFolders.error && <p role="alert" className="px-2 py-1 text-xs text-stone-500">Could not load folders. <button type="button" onClick={noteFolders.retry} className="underline">Retry folders</button></p>}
    <div className="max-h-48 overflow-y-auto">{noteFolders.data?.map(folder => <button key={folder.id} type="button" title={folder.name}
      aria-current={params.get('folder') === folder.id ? 'page' : undefined}
      onClick={() => router.push(`/?${new URLSearchParams({ view: 'all', folder: folder.id })}`)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 aria-[current=page]:bg-stone-100">
      <Folder className="h-4 w-4 shrink-0 text-stone-500" /><span className="min-w-0 flex-1 truncate">{folder.name}</span><span className="text-xs tabular-nums text-stone-400">{folder.noteCount}</span>
    </button>)}</div>
    <NoteFolderDialog open={creating} onOpenChange={setCreating} returnFocusRef={createTriggerRef} onCreated={folder => router.push(`/?${new URLSearchParams({ view: 'all', folder: folder.id })}`)} />
  </section>;
}

export function MeetingFoldersDialog({ meetingId, open, onOpenChange }: { meetingId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { noteFolders, folderRevision, refreshNoteFolders } = useSidebar();
  const selected = useFolderRead<string[]>('get_meeting_note_folders', { meetingId }, open, folderRevision);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [name, setName] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (busy || selected.loading || noteFolders.loading || !restoreFocusRef.current) return;
    if (restoreFocusRef.current.isConnected) restoreFocusRef.current.focus();
    restoreFocusRef.current = null;
  });
  useEffect(() => { setError(''); setName(''); }, [open, meetingId]);
  const toggle = async (folderId: string, included: boolean) => {
    if (busy || !selected.data) return;
    setBusy(true); setError('');
    try {
      await meetnolaInvoke('set_meeting_note_folder', { meetingId, folderId, included });
      selected.setData(included ? [...new Set([...selected.data, folderId])] : selected.data.filter(id => id !== folderId));
      refreshNoteFolders();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !name.trim() || !selected.data) return;
    setBusy(true); setError('');
    restoreFocusRef.current = nameInputRef.current;
    try {
      const folder = await meetnolaInvoke<NoteFolder>('create_note_folder', { name, meetingId });
      selected.setData([...selected.data, folder.id]); setName(''); refreshNoteFolders();
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  const loading = selected.loading || noteFolders.loading;
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => {
    const target = document.querySelector<HTMLButtonElement>(`button[data-meeting-actions-id="${CSS.escape(meetingId)}"]`)
      ?? document.querySelector<HTMLInputElement>('input[aria-label="Search saved notes"]');
    if (target) { event.preventDefault(); target.focus(); }
  }}>
    <DialogHeader><DialogTitle>Organize note</DialogTitle><DialogDescription>Choose folders for this note. Changes save automatically; recordings stay where they are.</DialogDescription></DialogHeader>
    {loading && <p role="status" className="text-sm text-stone-500">Loading folders…</p>}
    {(selected.error || noteFolders.error) && <p role="alert" className="text-sm text-red-700">Could not load this note’s folders. <button type="button" onClick={() => { selected.retry(); noteFolders.retry(); }} className="underline">Retry folders</button></p>}
    <div className="max-h-64 space-y-1 overflow-y-auto">{noteFolders.data?.map(folder => <label key={folder.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-stone-50">
      <input type="checkbox" checked={selected.data?.includes(folder.id) ?? false} disabled={busy || !selected.data || !noteFolders.data || Boolean(selected.error || noteFolders.error)} onChange={event => { restoreFocusRef.current = event.currentTarget; void toggle(folder.id, event.target.checked); }} className="h-4 w-4 shrink-0 accent-stone-900" />
      <span className="min-w-0 break-words">{folder.name}</span>
    </label>)}</div>
    {!loading && !noteFolders.error && noteFolders.data?.length === 0 && <p className="text-sm text-stone-500">Create your first folder below.</p>}
    <form onSubmit={create} className="border-t border-stone-200 pt-4">
      <label className="block text-sm">New folder name<input ref={nameInputRef} value={name} onChange={event => setName(event.target.value)} disabled={busy} maxLength={80} required className="mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2" /></label>
      <Button type="submit" variant="outline" className="mt-3" disabled={busy || loading || !selected.data || !name.trim()} >Create and add</Button>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {busy && <p role="status" className="text-xs text-stone-500">Saving folder changes…</p>}
    <DialogFooter><Button type="button" disabled={busy} onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
  </DialogContent></Dialog>;
}
