/**
 * RecordingSession identity contract.
 *
 * Capture, IndexedDB recovery, SQLite, live notes, and chat used to share one
 * conflated `currentMeetingId`. Resume then allocated a new live id and remounted
 * notes onto empty storage. Keep these ids distinct; see
 * `docs/recording-session-identity.md`.
 */

export type LiveSessionId = string;
export type PersistedMeetingId = string;
export type NotesOwnerId = string;
export type AppendTargetMeetingId = string;

/** Live capture / IndexedDB recovery id (`meeting-<timestamp>`). */
export const LIVE_SESSION_ID_STORAGE_KEY = 'indexeddb_current_meeting_id';
/** SQLite meeting that resume/append should write into. */
export const APPEND_TARGET_STORAGE_KEY = 'resume_meeting_id';
export const RESUME_BASELINE_COUNT_STORAGE_KEY = 'resume_baseline_count';
export const RESUME_SEQUENCE_SCOPE_STORAGE_KEY = 'resume_sequence_scope';

export type RecordingSessionIdentity = {
  /** Native capture generation. New on every start, including resume. */
  liveSessionId: LiveSessionId | null;
  /** SQLite meeting id once the session has been saved. */
  persistedMeetingId: PersistedMeetingId | null;
  /** Explicit resume/append target. When set, notes must stay on this id. */
  appendTargetMeetingId: AppendTargetMeetingId | null;
};

function hasStorage(storage: Storage | null | undefined): storage is Storage {
  return storage != null;
}

/** IndexedDB / live-draft ids: `meeting-<unix ms>` or `session-*`. */
export function isLiveSessionId(id: string | null | undefined): id is LiveSessionId {
  return Boolean(id && (/^meeting-\d+$/.test(id) || id.startsWith('session-')));
}

/** @deprecated Use `isLiveSessionId`. Same predicate; kept for call-site compatibility. */
export const isLiveMeetingId = isLiveSessionId;

export function isPersistedMeetingId(id: string | null | undefined): id is PersistedMeetingId {
  return Boolean(id && !isLiveSessionId(id));
}

export function allocateLiveSessionId(now = Date.now()): LiveSessionId {
  return `meeting-${now}`;
}

export function readLiveSessionId(storage?: Storage | null): string | null {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!hasStorage(store)) return null;
  return store.getItem(LIVE_SESSION_ID_STORAGE_KEY);
}

export function writeLiveSessionId(id: LiveSessionId, storage?: Storage | null) {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!hasStorage(store)) return;
  store.setItem(LIVE_SESSION_ID_STORAGE_KEY, id);
}

export function clearLiveSessionId(storage?: Storage | null) {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!hasStorage(store)) return;
  store.removeItem(LIVE_SESSION_ID_STORAGE_KEY);
}

export function readAppendTargetMeetingId(storage?: Storage | null): string | null {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!hasStorage(store)) return null;
  return store.getItem(APPEND_TARGET_STORAGE_KEY);
}

export function readResumeBaselineCount(storage?: Storage | null): number {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!hasStorage(store)) return 0;
  return Number(store.getItem(RESUME_BASELINE_COUNT_STORAGE_KEY) || '0');
}

export function writeResumeIdentity(
  persistedMeetingId: PersistedMeetingId,
  baselineCount: number,
  storage?: Storage | null,
) {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!hasStorage(store)) return;
  store.setItem(APPEND_TARGET_STORAGE_KEY, persistedMeetingId);
  store.setItem(RESUME_BASELINE_COUNT_STORAGE_KEY, String(baselineCount));
}

export function clearResumeIdentity(storage?: Storage | null) {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!hasStorage(store)) return;
  store.removeItem(APPEND_TARGET_STORAGE_KEY);
  store.removeItem(RESUME_BASELINE_COUNT_STORAGE_KEY);
  store.removeItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY);
}

/**
 * What `useMeetingNotes` must key off.
 *
 * Resume allocates a new `liveSessionId` for capture/IndexedDB. Notes stay on
 * the append target / persisted meeting so the editor does not remount onto
 * empty live storage.
 */
export function resolveNotesOwnerId(identity: RecordingSessionIdentity): NotesOwnerId | null {
  const { liveSessionId, persistedMeetingId, appendTargetMeetingId } = identity;
  if (appendTargetMeetingId) return appendTargetMeetingId;
  if (persistedMeetingId && liveSessionId && liveSessionId !== persistedMeetingId) {
    return persistedMeetingId;
  }
  return liveSessionId ?? persistedMeetingId;
}
