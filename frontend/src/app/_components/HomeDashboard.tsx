'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileAudio, FileText, Mic, MoreHorizontal, NotebookPen, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import type { TranscriptModelProps } from '@/components/TranscriptSettings';
import type { ModelConfig } from '@/services/configService';
import type { MeetingMetadata } from '@/services/indexedDBService';
import { loadQuickNoteDraft } from '@/lib/quickNoteDraft';
import { groupMeetingsByDay } from '@/lib/meetingTimeline';

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
  onOpenMeeting: (meetingId: string) => void;
  onOpenRecovery: () => void;
  onImportAudio: () => void;
  importEnabled: boolean;
  onStartRecording: () => void;
  onOpenDraft: () => void;
  onDeleteMeeting: (meetingId: string) => Promise<void>;
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
  isRecordingDisabled,
}: HomeDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.trim() || '';
  const showAll = searchParams.get('view') === 'all' || Boolean(query);
  const [quickNoteTitle, setQuickNoteTitle] = useState('New note');
  const [quickNoteDraft, setQuickNoteDraft] = useState('');
  const [quickNoteUpdatedAt, setQuickNoteUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const draft = loadQuickNoteDraft();

    setQuickNoteTitle(draft.title);
    setQuickNoteDraft(draft.content);
    setQuickNoteUpdatedAt(draft.updatedAt);
  }, []);

  const quickNotePreview = useMemo(() => {
    const normalized = quickNoteDraft.trim().replace(/\s+/g, ' ');
    if (!normalized) return 'Capture loose ideas, follow-ups, and prep notes without starting a recording.';
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

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const matchingMeetings = meetings.filter(meeting => meeting.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const recentMeetings = showAll ? matchingMeetings : meetings.slice(0, 8);
  const meetingGroups = groupMeetingsByDay(recentMeetings);
  const recoveryCount = recoverableMeetings.length;

  const openQuickNote = () => {
    onOpenDraft();
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
            <h1 className="text-lg font-semibold text-stone-900">Home</h1>
            <p className="mt-0.5 text-xs text-stone-500">{todayLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-md" onClick={openQuickNote}>
              <NotebookPen className="h-3.5 w-3.5" />
              New note
            </Button>
            <Button
              className="h-9 rounded-md bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
              onClick={onStartRecording}
              disabled={isRecordingDisabled}
            >
              <Mic className="h-3.5 w-3.5" />
              Start recording
            </Button>
          </div>
        </div>

        {/* Meeting timeline and supporting details */}
        <div className="mt-3 flex flex-col gap-8">

          {/* Recent meetings — primary list */}
          <div className="w-full">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">
                {showAll ? 'All meetings' : 'Recent meetings'}
              </p>
              {meetings.length > 0 && (
                <span className="text-xs text-stone-500">{query ? `${matchingMeetings.length} of ${meetings.length}` : meetings.length} sessions</span>
              )}
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button type="button" className="text-sm font-medium text-stone-700 underline" onClick={() => router.push(showAll ? '/' : '/?view=all')}>
                {showAll ? 'Show recent' : 'View all meetings'}
              </button>
              <form className="flex min-w-0 flex-1 gap-2" onSubmit={event => {
                  event.preventDefault();
                  const value = String(new FormData(event.currentTarget).get('q') || '').trim();
                  const params = new URLSearchParams({ view: 'all' });
                  if (value) params.set('q', value);
                  router.replace(`/?${params.toString()}`);
                }}>
                  <input key={query} name="q" type="search" aria-label="Search meeting titles" defaultValue={query} placeholder="Search meeting titles" className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
                  <Button type="submit" variant="outline">Search</Button>
              </form>
            </div>

            {recentMeetings.length > 0 ? (
              <div ref={menuRef}>
                {meetingGroups.map(group => <section key={group.key} className="mb-6" aria-label={group.label}>
                  <h2 className="mb-2 text-xs font-medium text-stone-500">{group.label}</h2>
                {group.meetings.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="group relative flex items-center gap-3 -mx-2 px-2 rounded-lg hover:bg-stone-100/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenMeeting(meeting.id)}
                      className="flex flex-1 items-center gap-3 py-2.5 text-left min-w-0"
                    >
                      <FileText className="h-8 w-8 shrink-0 rounded-md bg-stone-100 p-2 text-stone-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-800">{meeting.title}</p>
                        <p className="text-xs text-stone-500">{meeting.created_at && Number.isFinite(new Date(meeting.created_at).getTime()) ? new Date(meeting.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Saved locally'}</p>
                      </div>
                    </button>

                    {/* ... menu */}
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        aria-label={`Actions for ${meeting.title}`}
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === meeting.id ? null : meeting.id); }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-stone-500 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-stone-200 hover:text-stone-700"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>

                      {openMenuId === meeting.id && (
                        <div className="absolute right-0 top-8 z-20 w-36 rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            onClick={async () => {
                              setOpenMenuId(null);
                              await onDeleteMeeting(meeting.id);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                </section>)}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 bg-white/60 px-5 py-10 text-center">
                <p className="text-sm text-stone-500">{query ? 'No matching meetings' : 'No recordings yet'}</p>
                {query ? <button type="button" onClick={() => router.replace('/?view=all')} className="mt-2 text-sm underline">Clear search</button> : <p className="mt-1 text-xs text-stone-500">Start a meeting to see it here.</p>}
              </div>
            )}
          </div>

          {/* Draft and system details */}
          <div className="w-full space-y-5 border-t border-stone-100 pt-4">

            {/* Quick note */}
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Draft</p>
                <button
                  type="button"
                  onClick={openQuickNote}
                  className="text-xs text-stone-500 hover:text-stone-700 transition-colors"
                >
                  Open →
                </button>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={openQuickNote}
                onKeyDown={(e) => e.key === 'Enter' && openQuickNote()}
                className="w-full cursor-pointer rounded-md bg-stone-100 px-3.5 py-3 text-left transition-colors hover:border-stone-200 hover:bg-stone-100/70"
              >
                <p className="line-clamp-3 text-xs leading-[1.6] text-stone-600">{quickNotePreview}</p>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-xs text-stone-500">{formatRelativeTime(quickNoteUpdatedAt)}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); copyQuickNote(); }}
                    className="text-xs text-stone-500 hover:text-stone-700 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <hr className="border-stone-100" />

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
