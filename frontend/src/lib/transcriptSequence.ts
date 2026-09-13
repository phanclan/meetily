import type { Transcript } from '@/types';
import { RESUME_SEQUENCE_SCOPE_STORAGE_KEY } from '@/lib/recordingSessionIdentity';

/** Identity for one native session's sequence_id. Resume restarts ids at 1 in a new scope. */
export function transcriptSequenceKey(
  transcript: Pick<Transcript, 'sequence_id' | 'sequence_scope'>,
): string | null {
  if (transcript.sequence_id === undefined) return null;
  return `${transcript.sequence_scope ?? 0}:${transcript.sequence_id}`;
}

export function compareTranscriptOrder(a: Transcript, b: Transcript): number {
  const scopeDiff = (a.sequence_scope ?? 0) - (b.sequence_scope ?? 0);
  if (scopeDiff !== 0) return scopeDiff;
  const chunkTimeDiff = (a.chunk_start_time || 0) - (b.chunk_start_time || 0);
  if (chunkTimeDiff !== 0) return chunkTimeDiff;
  return (a.sequence_id || 0) - (b.sequence_id || 0);
}

/** New resume-session segments only. Scope wins so a resorted buffer cannot re-save old lines. */
export function selectResumedTranscripts(
  transcripts: Transcript[],
  baselineCount: number,
  resumeScope: number | null,
): Transcript[] {
  if (resumeScope != null && Number.isFinite(resumeScope)) {
    return transcripts.filter(transcript => (transcript.sequence_scope ?? 0) === resumeScope);
  }
  return transcripts.slice(Math.max(0, baselineCount));
}

export function readResumeSequenceScope(): number | null {
  const raw = sessionStorage.getItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY);
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
