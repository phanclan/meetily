// Keep written notes distinct from captured speech, including notes-only meetings.
export function buildMeetingContext(transcript: string, notes: string): string {
  return [
    notes.trim() ? `Written notes:\n${notes.trim()}` : '',
    transcript.trim() ? `Transcript:\n${transcript.trim()}` : '',
  ].filter(Boolean).join('\n\n');
}
