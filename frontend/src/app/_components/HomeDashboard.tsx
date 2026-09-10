'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileAudio, FileText, MessageCircle, Mic, MoreHorizontal, NotebookPen, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useSidebar, type CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import type { TranscriptModelProps } from '@/components/TranscriptSettings';
import type { ModelConfig } from '@/services/configService';
import type { MeetingMetadata } from '@/services/indexedDBService';
import { loadQuickNoteDraft } from '@/lib/quickNoteDraft';
import { groupMeetingsByDay } from '@/lib/meetingTimeline';
import { MeetingSearchResults } from '@/components/MeetingSearchResults';
import type { SavedMeetingMatch } from '@/hooks/useSavedMeetingSearch';
import { useFolderRead } from '@/hooks/useNoteFolders';
import { NoteFolderDialog, MeetingFoldersDialog } from '@/components/NoteFolderControls';

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
  const searchParams = useSearchParams();
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
  const meetingGroups = groupMeetingsByDay(recentMeetings);
  const recoveryCount = recoverableMeetings.length;

  const openQuickNote = () => {
    onOpenDraft(folderId || undefined);
  };

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-5 py-6 md:px-8">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <h1 className="break-words font-serif text-3xl tracking-tight text-stone-900 [overflow-wrap:anywhere]">{folderId ? folder?.name || 'Folder' : 'Your notes'}</h1>
            <p className="mt-0.5 text-xs text-stone-500">{todayLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-full shadow-none" onClick={openQuickNote}>
              <NotebookPen className="h-3.5 w-3.5" />
              {hasDraft ? 'Resume draft' : 'New note'}
            </Button>
            <Button
              className="h-9 rounded-full bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
              onClick={() => onStartRecording(folderId || undefined)}
              disabled={isRecordingDisabled}
            >
              <Mic className="h-3.5 w-3.5" />
              Start recording
            </Button>
          </div>
        </div>

        <button type="button" onClick={() => router.push('/ask')} className="mb-3 flex w-full items-center gap-3 rounded-full border border-stone-200 px-4 py-3 text-left text-sm text-stone-500 shadow-sm hover:bg-stone-50 focus-visible:outline-stone-400">
          <MessageCircle className="h-4 w-4" /><span>Ask your notes</span><span className="ml-auto hidden text-xs sm:inline">Across meetings</span>
        </button>

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
        <div className="mt-3 flex flex-col gap-8">

          {/* Recent meetings — primary list */}
          <div className="w-full">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1" aria-label="Meeting list view">
                <button type="button" className="rounded-full px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100" onClick={() => router.push(`/follow-ups${folderId ? `?folder=${encodeURIComponent(folderId)}` : ''}`)}>Follow-ups</button>
                <button type="button" aria-pressed={!showAll} className="rounded-full px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100 aria-pressed:bg-stone-100 aria-pressed:text-stone-900" onClick={() => { setSearch(''); router.push('/'); }}>Recent</button>
                <button type="button" aria-pressed={showAll && !folderId} className="rounded-full px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100 aria-pressed:bg-stone-100 aria-pressed:text-stone-900" onClick={() => router.push(`/?${new URLSearchParams({ view: 'all', ...(filter ? { q: filter } : {}) })}`)}>All notes</button>
              </div>
              <div className="flex items-center gap-2"><Button data-trash-trigger variant="ghost" size="sm" onClick={onOpenTrash}><Trash2 />Trash</Button>
              {!filter && visibleMeetings.length > 0 && (
                <span role="status" className="text-xs text-stone-500">{visibleMeetings.length} {visibleMeetings.length === 1 ? 'note' : 'notes'}</span>
              )}
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <select aria-label="Filter by folder" value={folderId} onChange={event => router.push(`/?${new URLSearchParams({ view: 'all', ...(event.target.value ? { folder: event.target.value } : {}), ...(filter ? { q: filter } : {}) })}`)} className="min-w-0 max-w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">
                <option value="">All folders</option>
                {folderId && !folder && <option value={folderId}>Selected folder</option>}
                {noteFolders.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <Button variant="ghost" size="sm" onClick={event => { folderFormTriggerRef.current = event.currentTarget; setFolderDialog('new'); }}>New folder</Button>
              {folder && <Button variant="ghost" size="sm" onClick={event => { folderFormTriggerRef.current = event.currentTarget; setFolderDialog('rename'); }}>Rename folder</Button>}
            </div>
            {noteFolders.error && <p role="alert" className="mb-3 text-sm text-stone-600">Could not load folders. <button onClick={noteFolders.retry} className="underline">Retry folders</button></p>}
            <div className="mb-6">
              <form role="search" className="flex min-w-0 items-center gap-2 rounded-xl bg-stone-100/70 px-3 focus-within:ring-1 focus-within:ring-stone-400" onSubmit={event => {
                  event.preventDefault();
                  const params = new URLSearchParams({ view: 'all' });
                  if (folderId) params.set('folder', folderId);
                  if (filter) params.set('q', filter);
                  router.replace(`/?${params.toString()}`);
                }}>
                  <Search aria-hidden="true" className="h-4 w-4 text-stone-400" />
                  <input ref={searchInputRef} name="q" type="search" aria-label="Search saved notes" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search titles, written notes, and transcripts…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" />
                  {search && <button type="button" aria-label="Clear search" className="rounded-full p-1.5 text-stone-500 hover:bg-stone-200" onClick={() => { setSearch(''); router.replace(folderId ? `/?${new URLSearchParams({ view: 'all', folder: folderId })}` : showAll ? '/?view=all' : '/'); }}><X className="h-4 w-4" /></button>}
              </form>
            </div>

            {folderId && folderMembers.error ? <p role="alert" className="py-6 text-sm text-stone-600">Could not load this folder. <button type="button" onClick={folderMembers.retry} className="underline">Retry folder</button></p>
              : folderId && folderMembers.loading && !folderMembers.data ? <p role="status" className="py-6 text-sm text-stone-500">Loading folder notes…</p>
              : filter ? <MeetingSearchResults key={`${folderId}:${folderRevision}`} query={filter} folderId={folderId || null} onOpenMeeting={(meetingId, match) => onOpenMeeting(meetingId, filter, match, folderId || undefined)} /> : recentMeetings.length > 0 ? (
              <div>
                {meetingGroups.map(group => <section key={group.key} className="mb-6" aria-label={group.label}>
                  <h2 className="mb-2 text-xs font-medium text-stone-500">{group.label}</h2>
                {group.meetings.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="group relative flex items-center gap-3 -mx-2 px-2 rounded-lg hover:bg-stone-100/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenMeeting(meeting.id, undefined, undefined, folderId || undefined)}
                      className="flex flex-1 items-center gap-3 py-3 text-left min-w-0"
                    >
                      <FileText className="h-8 w-8 shrink-0 rounded-md bg-stone-100 p-2 text-stone-500" />
                      <div className="min-w-0 flex-1">
                        <p title={meeting.title} className="truncate text-sm font-medium text-stone-800">{meeting.title}</p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-stone-500">{meeting.created_at && Number.isFinite(new Date(meeting.created_at).getTime()) ? new Date(meeting.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Saved locally'}</span>
                    </button>

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
                        <DropdownMenuItem onSelect={() => { openingOrganizerRef.current = true; setOrganizeMeetingId(meeting.id); }}>Organize note</DropdownMenuItem>
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
                <p className="mt-1 text-xs text-stone-500">{folderId ? 'Open a saved note and choose Organize note to add it here.' : 'Create a note or start a recording to see it here.'}</p>
              </div>
            )}
          </div>

          <NoteFolderDialog open={Boolean(folderDialog)} onOpenChange={open => { if (!open) setFolderDialog(null); }} folder={folderDialog === 'rename' ? folder : undefined} returnFocusRef={folderFormTriggerRef} onCreated={created => router.push(`/?${new URLSearchParams({ view: 'all', folder: created.id })}`)} />
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
