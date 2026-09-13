import { isNamedDraftPlaceholder, resolveSeededMeetingTitle } from '@/lib/meetingTitle';
import type { QuickNoteDraft } from '@/lib/quickNoteDraft';

export type NoteWorkspaceMode = 'draft' | 'recording';

const ATTACHABLE_SESSION_STATUSES = [
  'recording',
  'paused',
  'stopping',
  'processing_transcripts',
  'saving',
] as const;

export function workspaceRouteKey(
  mode: NoteWorkspaceMode,
  folderId: string | null,
  savedId: string | null,
) {
  return `${mode}|${folderId ?? ''}|${savedId ?? ''}`;
}

/**
 * A draft waiting on its own save belongs to the draft surface; never replay it
 * into a recording, where it would be saved a second time.
 */
export function draftForWorkspaceRoute(options: {
  isRecordingWorkspace: boolean;
  stored: QuickNoteDraft;
  requestedFolderId: string | null;
}): QuickNoteDraft {
  const { isRecordingWorkspace, stored, requestedFolderId } = options;
  if (isRecordingWorkspace && stored.saveId) {
    return { ...stored, title: 'New note', content: '', updatedAt: null, folderId: requestedFolderId };
  }
  return stored;
}

export function isAttachableRecordingSession(
  activeSession: { status?: string } | null | undefined,
  isRecording: boolean,
) {
  return Boolean(
    (activeSession && (ATTACHABLE_SESSION_STATUSES as readonly string[]).includes(activeSession.status || ''))
    || isRecording,
  );
}

export type SessionSeedPlan =
  | { kind: 'resume-append' }
  | { kind: 'attach-running'; title: string }
  | { kind: 'seed'; title: string; content: string; syncTitleToSession: boolean };

/**
 * Bind policy when a live capture id appears.
 *
 * Resume append must not reseed notes or rebind the folder from empty live storage.
 */
export function planSessionSeed(input: {
  resumeAppend: boolean;
  attachedToRunning: boolean;
  meetingTitle: string;
  noteTitle: string;
  draftContent: string;
  fallbackSeed: { title: string; content: string } | null;
  blocksEmpty: boolean;
}): SessionSeedPlan {
  if (input.resumeAppend) {
    return { kind: 'resume-append' };
  }

  if (input.attachedToRunning) {
    const liveTitle = input.meetingTitle?.trim() || '';
    return {
      kind: 'attach-running',
      title: liveTitle && !isNamedDraftPlaceholder(liveTitle) ? liveTitle : (liveTitle || 'New note'),
    };
  }

  const fallbackSeed = input.fallbackSeed;
  const liveDraftTitle = input.noteTitle.trim();
  const liveDraftContent = input.draftContent;
  const seedTitle = liveDraftTitle || fallbackSeed?.title?.trim() || '';
  const seedContent = liveDraftContent.trim().length > 0
    ? liveDraftContent
    : (fallbackSeed?.content ?? '');
  const sessionTitle = input.meetingTitle?.trim() || '';
  const nextTitle = resolveSeededMeetingTitle(seedTitle, sessionTitle);

  return {
    kind: 'seed',
    title: nextTitle,
    content: input.blocksEmpty && seedContent.trim() ? seedContent : '',
    syncTitleToSession: !isNamedDraftPlaceholder(nextTitle),
  };
}
