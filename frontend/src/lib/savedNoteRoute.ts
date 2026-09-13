import { isAfterword, type ProductFlavor } from '@/flavor/index';
import { createSavedRecordingPath } from '@/lib/quickNoteRoute';

export type SavedNoteOpenOptions = {
  flavor?: ProductFlavor;
  folderId?: string | null;
  /** Meetily meeting-details auto-summary hint. Ignored on Afterword. */
  source?: string | null;
  searchQuery?: string | null;
  matchKind?: 'notes' | 'transcript' | null;
  sourceId?: string | null;
  fromFollowUps?: boolean;
  followUpStatus?: string | null;
};

/**
 * Afterword's day-to-day saved-note surface is NoteWorkspace (`/recording?saved=`).
 * Meetily keeps `/meeting-details`. Search-source and Follow-ups stay on
 * meeting-details even in Afterword so those specialized back-nav/match panels
 * keep working.
 */
export function usesNoteWorkspaceForSavedNotes(flavor?: ProductFlavor): boolean {
  return (flavor ?? (isAfterword ? 'afterword' : 'meetily')) === 'afterword';
}

export function shouldKeepMeetingDetailsRoute(options: SavedNoteOpenOptions = {}): boolean {
  if (!usesNoteWorkspaceForSavedNotes(options.flavor)) return true;
  if (options.fromFollowUps) return true;
  if (options.searchQuery && options.sourceId && (options.matchKind === 'notes' || options.matchKind === 'transcript')) {
    return true;
  }
  return false;
}

function withParams(route: string, params: Array<[string, string | null | undefined]>) {
  const search = params
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join('&');
  return search ? `${route}?${search}` : route;
}

export function createSavedNotePath(meetingId: string, options: SavedNoteOpenOptions = {}): string {
  const folderId = options.folderId;
  if (!shouldKeepMeetingDetailsRoute(options)) {
    return createSavedRecordingPath(meetingId, folderId);
  }

  return withParams('/meeting-details', [
    ['id', meetingId],
    ['folder', folderId],
    ['source', options.source],
    ['search', options.searchQuery],
    ['match', options.matchKind && options.sourceId ? options.matchKind : null],
    ['sourceId', options.matchKind && options.sourceId ? options.sourceId : null],
    ['from', options.fromFollowUps ? 'follow-ups' : null],
    ['status', options.fromFollowUps ? options.followUpStatus : null],
  ]);
}
