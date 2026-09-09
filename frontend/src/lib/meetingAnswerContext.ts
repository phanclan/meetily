import type { Transcript } from '@/types';
import { storageService } from '@/services/storageService';

export interface MeetingSource {
  id: string;
  label: string;
  text: string;
  meetingId?: string;
}

export interface MeetingAnswerContext {
  context: string;
  sources: MeetingSource[];
  coverage?: string;
}

export function buildMeetingAnswerContext(transcripts: Transcript[], notes: string, scope: 'full' | 'last5min' = 'full'): MeetingAnswerContext {
  const sources: MeetingSource[] = [];
  if (notes.trim()) sources.push({ id: 'S1', label: 'Written notes', text: notes.trim() });
  const latest = transcripts.reduce((latest, item) => Number.isFinite(item.audio_start_time)
    ? Math.max(latest, item.audio_start_time ?? 0) : latest, 0);
  for (const item of transcripts) {
    if (!item.text.trim()) continue;
    if (scope === 'last5min' && item.audio_start_time != null && item.audio_start_time < latest - 300) continue;
    const seconds = item.audio_start_time;
    const time = seconds != null && Number.isFinite(seconds) && seconds >= 0
      ? `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
      : null;
    sources.push({ id: `S${sources.length + 1}`, label: time ? `Transcript · ${time}` : 'Transcript', text: item.text });
  }
  return { sources, context: sources.map(source => `[${source.id}] ${source.label}\n${source.text}`).join('\n\n') };
}

export async function loadMeetingAnswerContext(meetingId: string, notes: { text: string; isReady: boolean }, scope: 'full' | 'last5min' = 'full'): Promise<MeetingAnswerContext> {
  if (!notes.isReady) throw new Error('Load the written notes before asking about this meeting.');
  const meeting = await storageService.getMeeting(meetingId);
  if (!Array.isArray(meeting.transcripts)) throw new Error('Could not load the complete meeting transcript. Try again.');
  return buildMeetingAnswerContext(meeting.transcripts, notes.text, scope);
}
