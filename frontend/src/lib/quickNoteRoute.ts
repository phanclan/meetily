/**
 * Route helpers for the two note surfaces.
 *
 * `/quick-note` is the draft surface: it never captures audio.
 * `/recording` is the live recording workspace: entering it starts a session, or
 * attaches to the one already running. Because the intent lives in the path
 * instead of a one-shot token, a reload keeps the workspace live.
 */

export const DRAFT_NOTE_ROUTE = '/quick-note';
export const RECORDING_ROUTE = '/recording';

function withParams(route: string, params: Array<[string, string | null | undefined]>) {
  const search = params
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join('&');
  return search ? `${route}?${search}` : route;
}

export function createDraftNotePath(folderId?: string | null) {
  return withParams(DRAFT_NOTE_ROUTE, [['folder', folderId]]);
}

export function createRecordingPath(folderId?: string | null) {
  return withParams(RECORDING_ROUTE, [['folder', folderId]]);
}

/**
 * The recording workspace after its session was saved. Keeping the meeting in the
 * URL means a reload reopens the saved note instead of starting a new recording.
 */
export function createSavedRecordingPath(meetingId: string, folderId?: string | null) {
  return withParams(RECORDING_ROUTE, [['saved', meetingId], ['folder', folderId]]);
}

/** The folder a workspace route was opened with, read straight from the URL. */
export function folderFromSearch(search: string | null | undefined) {
  const match = /[?&]folder=([^&]*)/.exec(search || '');
  return match ? decodeURIComponent(match[1]) : null;
}

export function isNoteWorkspaceRoute(pathname: string) {
  return pathname === DRAFT_NOTE_ROUTE || pathname === RECORDING_ROUTE;
}
