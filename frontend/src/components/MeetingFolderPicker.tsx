'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Folder, Plus } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { afterwordInvoke } from '@/afterword/ipc';
import { useFolderRead, type NoteFolder } from '@/hooks/useNoteFolders';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Variant = 'chip' | 'ghost';

export function MeetingFolderPicker({
  meetingId,
  variant = 'chip',
  className,
  eagerMembership = false,
}: {
  meetingId: string;
  variant?: Variant;
  className?: string;
  /** Prefetch folder membership for the chip label (use on open-note; leave false on long lists). */
  eagerMembership?: boolean;
}) {
  const { noteFolders, folderRevision, refreshNoteFolders } = useSidebar();
  const [open, setOpen] = useState(false);
  const membership = useFolderRead<string[]>('get_meeting_note_folders', { meetingId }, open || eagerMembership, folderRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selectedIds = membership.data ?? [];
  const selectedFolders = useMemo(() => {
    const folders = noteFolders.data ?? [];
    return selectedIds
      .map(id => folders.find(folder => folder.id === id))
      .filter((folder): folder is NoteFolder => Boolean(folder));
  }, [noteFolders.data, selectedIds]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCreating(false);
      setName('');
      setError('');
      return;
    }
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (creating) requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [creating]);

  const filtered = useMemo(() => {
    const folders = noteFolders.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return folders;
    return folders.filter(folder => folder.name.toLowerCase().includes(needle));
  }, [noteFolders.data, query]);

  const label = (() => {
    if (!membership.data && !eagerMembership && !open) return 'Add to folder';
    if (selectedFolders.length === 1) return `Add to ${selectedFolders[0].name}`;
    if (selectedFolders.length > 1) return `In ${selectedFolders.length} folders`;
    return 'Add to folder';
  })();

  const toggle = async (folderId: string, included: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const previous = selectedIds;
    const next = included
      ? [...new Set([...previous, folderId])]
      : previous.filter(id => id !== folderId);
    membership.setData(next);
    try {
      await afterwordInvoke('set_meeting_note_folder', { meetingId, folderId, included });
      refreshNoteFolders();
    } catch (err) {
      membership.setData(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const folder = await afterwordInvoke<NoteFolder>('create_note_folder', { name: name.trim(), meetingId });
      const next = [...new Set([...selectedIds, folder.id])];
      membership.setData(next);
      setName('');
      setCreating(false);
      refreshNoteFolders();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-meeting-folder-picker={meetingId}
          className={cn(
            variant === 'chip'
              ? 'inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50'
              : 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-stone-600 opacity-0 transition-opacity hover:bg-stone-200 hover:text-stone-800 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
            open && variant === 'ghost' && 'opacity-100',
            className,
          )}
          onClick={event => event.stopPropagation()}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden="true" />
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-stone-400" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-0"
        onClick={event => event.stopPropagation()}
        onOpenAutoFocus={event => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="border-b border-stone-100 p-2">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search folders"
            aria-label="Search folders"
            className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400"
          />
        </div>
        <div className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label="Folders">
          {(membership.loading || noteFolders.loading) && !noteFolders.data && (
            <p role="status" className="px-3 py-2 text-sm text-stone-500">Loading folders…</p>
          )}
          {(membership.error || noteFolders.error) && (
            <p role="alert" className="px-3 py-2 text-sm text-red-700">
              Could not load folders.{' '}
              <button type="button" className="underline" onClick={() => { membership.retry(); noteFolders.retry(); }}>Retry</button>
            </p>
          )}
          {!noteFolders.loading && !noteFolders.error && filtered.length === 0 && (
            <p className="px-3 py-2 text-sm text-stone-500">{query.trim() ? 'No matching folders' : 'No folders yet'}</p>
          )}
          {filtered.map(folder => {
            const checked = selectedIds.includes(folder.id);
            return (
              <button
                key={folder.id}
                type="button"
                role="option"
                aria-selected={checked}
                disabled={busy || membership.loading}
                onClick={() => void toggle(folder.id, !checked)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-800 hover:bg-stone-50 disabled:opacity-50"
              >
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300')}>
                  {checked ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                <span className="text-xs tabular-nums text-stone-400">{folder.noteCount}</span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-stone-100 p-2">
          {creating ? (
            <form
              className="flex items-center gap-2"
              onSubmit={event => {
                event.preventDefault();
                void create();
              }}
            >
              <input
                ref={nameInputRef}
                value={name}
                onChange={event => setName(event.target.value)}
                maxLength={80}
                placeholder="New folder name"
                aria-label="New folder name"
                disabled={busy}
                className="min-w-0 flex-1 rounded-md border border-stone-200 px-2 py-1.5 text-sm outline-none focus:border-stone-400"
              />
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>Add</Button>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New folder
            </button>
          )}
          {error && <p role="alert" className="mt-2 px-1 text-xs text-red-700">{error}</p>}
          {busy && <p role="status" className="mt-2 px-1 text-xs text-stone-500">Saving…</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
