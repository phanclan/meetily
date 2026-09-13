'use client';

import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useNoteTasks } from '@/hooks/useNoteTasks';
import { NotesLibraryTabs, NotesLibraryToolbar } from '@/app/_components/NotesLibraryChrome';
import { ChromeDragBar } from '@/components/WindowChrome';

export default function FollowUpsPage() {
  return <Suspense fallback={<p className="p-8 text-sm text-stone-500">Loading follow-ups…</p>}><FollowUps /></Suspense>;
}

function FollowUps() {
  const router = useRouter();
  const params = useSearchParams();
  const folderId = params.get('folder') || '';
  const checked = params.get('status') === 'completed';
  const { noteFolders } = useSidebar();
  const list = useNoteTasks(checked, folderId);
  const [notice, setNotice] = useState('');
  const filterRef = useRef<HTMLButtonElement>(null);
  const navigate = (completed: boolean, folder: string) => router.replace(`/follow-ups?${new URLSearchParams({ ...(completed ? { status: 'completed' } : {}), ...(folder ? { folder } : {}) })}`);
  const busy = list.loading || list.saving;
  return <main className="flex h-full min-h-0 flex-1 flex-col bg-background text-stone-900" aria-label="Follow-ups">
    <ChromeDragBar className="justify-end px-3">
      <button disabled={busy} onClick={() => void list.refresh()} className="no-drag flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
    </ChromeDragBar>
    <div className="notes-scroll-frame">
    <div className="notes-scrollbar">
    <div className="mx-auto w-full max-w-3xl px-5 pb-6 pt-0 md:px-8">
      <h1 className="font-serif text-2xl tracking-tight">Follow-ups</h1>
      <p className="mt-0.5 min-h-4 text-xs leading-4 text-stone-500">Checkboxes from your written notes. Changes here update the original note.</p>
      <div className="mb-2 mt-3 flex min-h-9 flex-wrap items-center justify-between gap-2">
        <NotesLibraryTabs current="follow-ups" folderId={folderId} />
      </div>
      <NotesLibraryToolbar>
        <div className="flex shrink-0 gap-1" aria-label="Follow-up status">
          <button ref={!checked ? filterRef : undefined} disabled={list.saving} aria-pressed={!checked} onClick={() => navigate(false, folderId)} className="rounded-full px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100 aria-pressed:bg-stone-100 aria-pressed:text-stone-900">Open</button>
          <button ref={checked ? filterRef : undefined} disabled={list.saving} aria-pressed={checked} onClick={() => navigate(true, folderId)} className="rounded-full px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100 aria-pressed:bg-stone-100 aria-pressed:text-stone-900">Completed</button>
        </div>
        <select aria-label="Filter by folder" disabled={list.saving} value={folderId} onChange={event => navigate(checked, event.target.value)} className="h-9 max-w-[11rem] shrink-0 rounded-md border border-stone-200 bg-white px-2.5 text-sm text-stone-700 sm:max-w-[14rem]">
          <option value="">All folders</option>
          {folderId && !noteFolders.data?.some(folder => folder.id === folderId) && <option value={folderId}>Selected folder</option>}
          {noteFolders.data?.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
        <span className="min-h-9 min-w-0 flex-1" aria-hidden />
      </NotesLibraryToolbar>
      <p role="status" className="sr-only">{notice}</p>
      {list.error && <div role="alert" className="mb-4 rounded-md bg-stone-100 px-4 py-3 text-sm text-stone-700">{list.error} <button disabled={busy} onClick={() => void list.refresh()} className="underline">Retry</button></div>}
      <ul aria-label="Follow-up list" aria-busy={busy} className="divide-y divide-stone-100">
        {list.tasks.map((task, index) => <li key={`${task.meetingId}:${task.blockId}:${index}`} className="flex items-start gap-3 py-4">
          <input type="checkbox" checked={task.checked} disabled={busy} aria-label={`Mark ${task.text || 'untitled checkbox'} ${task.checked ? 'open' : 'complete'}`} className="mt-1 h-4 w-4 shrink-0 accent-stone-800" onChange={() => { void list.toggle(task).then(saved => { if (saved) { setNotice(task.checked ? 'Follow-up reopened.' : 'Follow-up completed.'); filterRef.current?.focus(); } }); }} />
          <div className="min-w-0 flex-1">
            <p className={`whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere] ${task.checked ? 'text-stone-500 line-through' : ''}`}>{task.text || 'Untitled checkbox'}</p>
            <button disabled={list.saving} onClick={() => router.push(`/meeting-details?${new URLSearchParams({ id: task.meetingId, view: 'notes', from: 'follow-ups', ...(folderId ? { folder: folderId } : {}), ...(checked ? { status: 'completed' } : {}) })}`)} className="mt-1 flex max-w-full items-center gap-1 rounded-sm text-left text-xs text-stone-500 hover:text-stone-900">
              <span className="break-words [overflow-wrap:anywhere]">{task.title || 'Untitled note'}</span><ArrowUpRight className="h-3 w-3 shrink-0" /><span className="sr-only">Open original note</span>
            </button>
          </div>
        </li>)}
      </ul>
      {list.loading && <p role="status" className="py-6 text-sm text-stone-500">Loading follow-ups…</p>}
      {!busy && !list.error && !list.tasks.length && <p className="py-8 text-sm leading-6 text-stone-500">{checked ? 'No completed checkboxes in these notes.' : 'No open checkboxes in these notes. Add a checklist item in a written note to track a follow-up here.'}</p>}
      {list.hasMore && !list.error && <button disabled={busy} onClick={() => void list.loadMore()} className="mt-5 rounded-full border border-stone-200 px-4 py-2 text-sm disabled:opacity-40">Load more follow-ups</button>}
    </div>
    </div>
    </div>
  </main>;
}
