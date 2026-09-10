import { meetnolaInvoke } from '@/meetnola/ipc';

export async function exportSavedMeeting(meetingId: string, flush: () => Promise<void>): Promise<string> {
  // Export only after pending title, original-note, and enhancement writes succeed.
  await flush();
  return meetnolaInvoke<string>('export_meeting_markdown', { meetingId });
}
