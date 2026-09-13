'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileAudio, FileText, Mic, MoreHorizontal, NotebookPen, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { AskNotesPanel } from '@/app/_components/AskNotesPanel';
import { ASK_CHAT_QUERY, ASK_QUERY, homeAskPath, homeLibraryPath, homePathWithoutAsk, type HomeLibraryPathUpdates } from '@/lib/askRoute';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useSidebar, type CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import type { TranscriptModelProps } from '@/components/TranscriptSettings';
import type { ModelConfig } from '@/services/configService';
import type { MeetingMetadata } from '@/services/indexedDBService';
import { loadQuickNoteDraft } from '@/lib/quickNoteDraft';
import { groupMeetingsByTimeRange } from '@/lib/meetingTimeline';
import { MeetingSearchResults } from '@/components/MeetingSearchResults';
import type { SavedMeetingMatch } from '@/hooks/useSavedMeetingSearch';
import { useFolderRead } from '@/hooks/useNoteFolders';
import { NoteFolderDialog, MeetingFoldersDialog } from '@/components/NoteFolderControls';
import { MeetingFolderPicker } from '@/components/MeetingFolderPicker';
import { NotesLibraryTabs, NotesLibraryToolbar } from '@/app/_components/NotesLibraryChrome';
import { ChromeDragBar } from '@/components/WindowChrome';

interface HomeDashboardProps {
  meetings: CurrentMeeting[];
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  isCheckingPermissions: boolean;
  transcriptModelConfig: TranscriptModelProps;
  modelConfig: ModelConfig;
  selectedDevices: {
    micDevice: string | null;
    systemDevice: string | null;
  };
  recoverableMeetings: MeetingMetadata[];
  onOpenMeeting: (meetingId: string, searchQuery?: string, match?: SavedMeetingMatch, folderId?: string) => void;
  onOpenRecovery: () => void;
  onImportAudio: () => void;
  importEnabled: boolean;
  onStartRecording: (folderId?: string) => void;
  onOpenDraft: (folderId?: string) => void;
  onDeleteMeeting: (meetingId: string) => Promise<void>;
  onOpenTrash: () => void;
  isRecordingDisabled: boolean;
}

function formatRelativeTime(timestamp: number | null) {
  if (!timestamp) return 'Saved locally';

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return 'Updated just now';
  if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Updated ${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

export function HomeDashboard({
  meetings,
  hasMicrophone,
  hasSystemAudio,
  isCheckingPermissions,
  transcriptModelConfig,
  modelConfig,
  selectedDevices,
  recoverableMeetings,
  onOpenMeeting,
  onOpenRecovery,
  onImportAudio,
  importEnabled,
  onStartRecording,
  onOpenDraft,
  onDeleteMeeting,
  onOpenTrash,
  isRecordingDisabled,
}: HomeDashboardProps) {
  const router = useRouter();

  useEffect(() => {
    router.prefetch('/recording');
    // Quietly warm the recording workspace chunk so the first New note after cold
    // start does not wait on compile/load. Does not navigate or start recording.
    const warm = () => {
      void import('@/app/recording/page');
      void import('@/app/_components/NoteWorkspace');
    };
    if (typeof window === 'undefined') return;
    // Hoisted before the `in` check below: narrowing `window` itself leaves the
    // fallback branch with `window` typed as `never`.
    const scheduleTimeout = window.setTimeout.bind(window);
    const cancelTimeout = window.clearTimeout.bind(window);
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = scheduleTimeout(warm, 0);
    return () => cancelTimeout(timer);
  }, [router]);
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const askOpen = searchParams.get(ASK_QUERY) === '1';
  const askChatId = searchParams.get(ASK_CHAT_QUERY);
  const askChatPath = useCallback((id: string) => homeAskPath(queryString, id), [queryString]);
  const libraryPath = useCallback(
    (updates: HomeLibraryPathUpdates) => homeLibraryPath(queryString, updates),
    [queryString],
  );
  const closeAsk = useCallback(() => {
    router.replace(homePathWithoutAsk(queryString));
  }, [router, queryString]);
  const setAskExpanded = useCallback((expanded: boolean) => {
    if (expanded) router.replace(homeAskPath(queryString, askChatId));
    else closeAsk();
  }, [router, queryString, askChatId, closeAsk]);
  const { noteFolders, folderRevision } = useSidebar();
  const folderId = searchParams.get('folder') || '';
  const folder = noteFolders.data?.find(item => item.id === folderId);
  const folderMembers = useFolderRead<string[]>('get_note_folder_members', { folderId }, Boolean(folderId), folderRevision);
  const memberIds = useMemo(() => new Set(folderMembers.data ?? []), [folderMembers.data]);
  const [folderDialog, setFolderDialog] = useState<'new' | 'rename' | null>(null);
  const folderFormTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [organizeMeetingId, setOrganizeMeetingId] = useState<string | null>(null);
  const query = searchParams.get('q')?.trim() || '';
  const [search, setSearch] = useState(query);
  useEffect(() => { setSearch(query); }, [query]);
  const filter = search.trim();
  const showAll = searchParams.get('view') === 'all' || Boolean(filter) || Boolean(folderId);
  const [quickNoteTitle, setQuickNoteTitle] = useState('New note');
  const [quickNoteDraft, setQuickNoteDraft] = useState('');
  const [quickNoteUpdatedAt, setQuickNoteUpdatedAt] = useState<number | null>(null);
  const [quickNoteSavePending, setQuickNoteSavePending] = useState(false);

  useEffect(() => {
    const draft = loadQuickNoteDraft();

    setQuickNoteTitle(draft.title);
    setQuickNoteDraft(draft.content);
    setQuickNoteUpdatedAt(draft.updatedAt);
    setQuickNoteSavePending(Boolean(draft.saveId));
  }, []);

  const quickNotePreview = useMemo(() => {
    const normalized = quickNoteDraft.trim().replace(/\s+/g, ' ');
    if (!normalized) return 'Continue writing your note.';
    return normalized.slice(0, 220);
  }, [quickNoteDraft]);

  const copyQuickNote = async () => {
    if (!quickNoteDraft.trim()) {
      toast.error('Quick note is empty');
      return;
    }

    try {
      await navigator.clipboard.writeText(quickNoteDraft.trim());
      toast.success('Quick note copied');
    } catch (error) {
      toast.error('Failed to copy quick note');
    }
  };

  const hasDraft = Boolean(quickNoteDraft.trim() || quickNoteSavePending ||
    (quickNoteTitle.trim() && quickNoteTitle !== 'New note'));
  const openingOrganizerRef = useRef(false);
  const movingToTrashRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const visibleMeetings = folderId ? meetings.filter(meeting => memberIds.has(meeting.id)) : meetings;
  const recentMeetings = showAll ? visibleMeetings : visibleMeetings.slice(0, 8);
  const meetingGroups = groupMeetingsByTimeRange(recentMeetings);
  const recoveryCount = recoverableMeetings.length;

  const openQuickNote = () => {
    onOpenDraft(folderId || undefined);
  };

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const libraryView = folderId ? 'all' : showAll ? 'all' : 'recent';

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ChromeDragBar className="justify-end px-3">
        <div className="no-drag flex items-center justify-end gap-1.5">
          {hasDraft && (
            <Button variant="outline" size="sm" className="h-7 rounded-full px-3 shadow-none" onClick={openQuickNote}>
              <NotebookPen className="h-3.5 w-3.5" />
              Resume draft
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 rounded-full bg-stone-900 px-3 text-xs font-medium text-white hover:bg-stone-800"
            onClick={() => onStartRecording(folderId || undefined)}
            disabled={isRecordingDisabled}
          >
            <Mic className="h-3.5 w-3.5" />
            New note
          </Button>
        </div>
      </ChromeDragBar>

      <div className="notes-scroll-frame">
      <div className="notes-scrollbar">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pb-4 pt-0 md:px-8">
        <div>
          <h1 className="break-words font-serif text-2xl tracking-tight text-stone-900 [overflow-wrap:anywhere]">{folderId ? folder?.name || 'Folder' : 'Your notes'}</h1>
          <p className="mt-0.5 text-xs leading-4 text-stone-500">{todayLabel}</p>
        </div>

        {hasDraft && (
          <section aria-label="Unfinished draft" className="mb-3 flex min-w-0 items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
            <button type="button" onClick={openQuickNote} className="min-w-0 flex-1 text-left">
              <span className="text-xs font-medium text-stone-500">{quickNoteSavePending ? 'Finish saving your draft' : 'Continue where you left off'}</span>
              <p className="mt-1 truncate text-sm font-medium text-stone-800">{quickNoteTitle === 'New note' ? 'Untitled draft' : quickNoteTitle}</p>
              <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-stone-500 [overflow-wrap:anywhere]">{quickNotePreview}</p>
              <span className="mt-2 block text-xs text-stone-500">{formatRelativeTime(quickNoteUpdatedAt)}</span>
            </button>
            {quickNoteDraft.trim() && <Button variant="ghost" size="sm" aria-label="Copy draft" onClick={copyQuickNote}>Copy</Button>}
          </section>
        )}

        {/* Meeting timeline and supporting details */}
        <div className="mt-1 flex flex-col gap-3">

          {/* Recent meetings — primary list */}
          <div className="w-full">
            <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2">
              <NotesLibraryTabs
                current={libraryView}
                folderId={folderId}
                filter={filter}
                onRecent={() => { setSearch(''); }}
              />
              <div className="flex items-center gap-2"><Button data-trash-trigger variant="ghost" size="sm" onClick={onOpenTrash}><Trash2 />Trash</Button>
              {!filter && visibleMeetings.length > 0 && (
                <span role="status" className="text-xs text-stone-500">{visibleMeetings.length} {visibleMeetings.length === 1 ? 'note' : 'notes'}</span>
              )}
              </div>
            </div>

            <NotesLibraryToolbar>
              <select aria-label="Filter by folder" value={folderId} onChange={event => router.push(libraryPath({ view: 'all', folder: event.target.value || null, q: filter || null }))} className="h-9 max-w-[11rem] shrink-0 rounded-md border border-stone-200 bg-white px-2.5 text-sm text-stone-700 sm:max-w-[14rem]">
                <option value="">All folders</option>
                {folderId && !folder && <option value={folderId}>Selected folder</option>}
                {noteFolders.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={event => { folderFormTriggerRef.current = event.currentTarget; setFolderDialog('new'); }}>New folder</Button>
              {folder ? <Button variant="ghost" size="sm" className="shrink-0" onClick={event => { folderFormTriggerRef.current = event.currentTarget; setFolderDialog('rename'); }}>Rename</Button> : <span className="hidden h-9 w-[4.75rem] shrink-0 sm:block" aria-hidden />}
              <form role="search" className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-stone-100/70 px-2.5 focus-within:ring-1 focus-within:ring-stone-400" onSubmit={event => {
                  event.preventDefault();
                  router.replace(libraryPath({ view: 'all', folder: folderId || null, q: filter || null }));
                }}>
                  <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400" />
                  <input ref={searchInputRef} name="q" type="search" aria-label="Search saved notes" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search notes…" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
                  {search && <button type="button" aria-label="Clear search" className="rounded-full p-1 text-stone-500 hover:bg-stone-200" onClick={() => { setSearch(''); router.replace(folderId ? libraryPath({ view: 'all', folder: folderId, q: null }) : showAll ? libraryPath({ view: 'all', q: null }) : libraryPath({ view: null, folder: null, q: null })); }}><X className="h-4 w-4" /></button>}
              </form>
            </NotesLibraryToolbar>
            {noteFolders.error && <p role="alert" className="mb-2 text-sm text-stone-600">Could not load folders. <button onClick={noteFolders.retry} className="underline">Retry folders</button></p>}

            {folderId && folderMembers.error ? <p role="alert" className="py-6 text-sm text-stone-600">Could not load this folder. <button type="button" onClick={folderMembers.retry} className="underline">Retry folder</button></p>
              : folderId && folderMembers.loading && !folderMembers.data ? <p role="status" className="py-6 text-sm text-stone-500">Loading folder notes…</p>
              : filter ? <MeetingSearchResults key={`${folderId}:${folderRevision}`} query={filter} folderId={folderId || null} onOpenMeeting={(meetingId, match) => onOpenMeeting(meetingId, filter, match, folderId || undefined)} /> : recentMeetings.length > 0 ? (
              <div>
                {meetingGroups.map(group => <section key={group.key} className="mb-3" aria-label={group.label}>
                  <h2 className="mb-1 text-xs font-medium text-stone-500">{group.label}</h2>
                {group.meetings.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="group relative -mx-2 flex items-center gap-2 rounded-md px-2 hover:bg-stone-100/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenMeeting(meeting.id, undefined, undefined, folderId || undefined)}
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                    >
                      <FileText className="h-6 w-6 shrink-0 rounded-md bg-stone-100 p-1.5 text-stone-500" />
                      <div className="min-w-0 flex-1">
                        <p title={meeting.title} className="truncate text-sm font-medium text-stone-800">{meeting.title}</p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-stone-500">{meeting.created_at && Number.isFinite(new Date(meeting.created_at).getTime()) ? new Date(meeting.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Saved locally'}</span>
                    </button>

                    <MeetingFolderPicker meetingId={meeting.id} variant="ghost" className="shrink-0" />

                    {/* ... menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Actions for ${meeting.title}`}
                        data-meeting-actions-id={meeting.id}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-500 transition-opacity sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:bg-stone-200 hover:text-stone-700"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onCloseAutoFocus={event => {
                        if (openingOrganizerRef.current) {
                          event.preventDefault();
                          openingOrganizerRef.current = false;
                        } else if (movingToTrashRef.current) {
                          event.preventDefault();
                          movingToTrashRef.current = false;
                          searchInputRef.current?.focus();
                        }
                      }}>
                        <DropdownMenuItem onSelect={() => { openingOrganizerRef.current = true; setOrganizeMeetingId(meeting.id); }}>Manage folders…</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { movingToTrashRef.current = true; void onDeleteMeeting(meeting.id); }} className="text-red-600 focus:bg-red-50 focus:text-red-700">
                          <Trash2 aria-hidden="true" />Move to Trash
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
                </section>)}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 bg-white/60 px-5 py-10 text-center">
                <p className="text-sm text-stone-500">{folderId ? 'No notes in this folder yet' : 'No notes yet'}</p>
                <p className="mt-1 text-xs text-stone-500">{folderId ? 'Use Add to folder on a note, or open it and choose a folder.' : 'Click New note to start recording.'}</p>
              </div>
            )}
          </div>

          <NoteFolderDialog open={Boolean(folderDialog)} onOpenChange={open => { if (!open) setFolderDialog(null); }} folder={folderDialog === 'rename' ? folder : undefined} returnFocusRef={folderFormTriggerRef} onCreated={created => router.push(libraryPath({ view: 'all', folder: created.id, q: null }))} />
          {organizeMeetingId && <MeetingFoldersDialog meetingId={organizeMeetingId} open onOpenChange={open => { if (!open) setOrganizeMeetingId(null); }} />}
          {/* System details */}
          <div className="w-full space-y-5 border-t border-stone-100 pt-4">

            {/* System details stay available without competing with the meeting list. */}
            <details open={recoveryCount > 0 || (!isCheckingPermissions && !hasMicrophone)}>
              <summary className="mb-2.5 cursor-pointer text-xs font-medium text-stone-500">{recoveryCount > 0 ? `Recovery available (${recoveryCount})` : 'System & recovery'}</summary>
              <div className="space-y-0.5">
                <StatusRow
                  label="Microphone"
                  value={
                    isCheckingPermissions ? 'Checking…'
                      : hasMicrophone ? (selectedDevices.micDevice || 'Default')
                        : 'Not detected'
                  }
                  tone={hasMicrophone ? 'good' : 'warn'}
                />
                <StatusRow
                  label="System audio"
                  value={
                    isCheckingPermissions ? 'Checking…'
                      : hasSystemAudio ? (selectedDevices.systemDevice || 'Default')
                        : 'Not detected'
                  }
                  tone={hasSystemAudio ? 'good' : 'muted'}
                />
                <StatusRow
                  label="Transcription"
                  value={`${transcriptModelConfig.provider} / ${transcriptModelConfig.model}`}
                  tone="neutral"
                />
                <StatusRow
                  label="Summary"
                  value={`${modelConfig.provider} / ${modelConfig.model}`}
                  tone="neutral"
                />
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onOpenRecovery}
                  className="flex flex-1 items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-3 py-2.5 text-left transition-colors hover:border-stone-200 hover:bg-stone-100"
                >
                  <div>
                    <p className="text-xs font-medium text-stone-700">Recovery</p>
                    <p className="text-xs text-stone-500">
                      {recoveryCount > 0 ? `${recoveryCount} ready` : 'None'}
                    </p>
                  </div>
                  <RefreshCw className="h-3 w-3 text-stone-500" />
                </button>
                <button
                  type="button"
                  onClick={onImportAudio}
                  className="flex flex-1 items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-3 py-2.5 text-left transition-colors hover:border-stone-200 hover:bg-stone-100"
                >
                  <div>
                    <p className="text-xs font-medium text-stone-700">Import</p>
                    <p className="text-xs text-stone-500">
                      {importEnabled ? 'Enabled' : 'Beta only'}
                    </p>
                  </div>
                  <FileAudio className="h-3 w-3 text-stone-500" />
                </button>
              </div>
            </details>

          </div>
        </div>
      </div>
      </div>
      </div>
      <AskNotesPanel
        expanded={askOpen}
        onExpandedChange={setAskExpanded}
        chatPath={askChatPath}
        chatId={askChatId}
      />
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'muted' | 'neutral';
}) {
  const dotColor = {
    good: 'bg-emerald-500',
    warn: 'bg-amber-400',
    muted: 'bg-stone-300',
    neutral: 'bg-stone-400',
  } as const;

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-50">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-md ${dotColor[tone]}`} />
      <span className="w-20 shrink-0 text-xs font-medium text-stone-500">{label}</span>
      <span className="min-w-0 truncate text-xs text-stone-800">{value}</span>
    </div>
  );
}
