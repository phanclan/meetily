'use client';

export function buildEnhanceNotesPrompt(notesText: string) {
  const trimmedNotes = notesText.trim();
  if (!trimmedNotes) {
    return '';
  }

  return [
    'Use the typed meeting notes below as additional context alongside the transcript.',
    'Preserve the user-written intent, merge overlapping points, and do not invent facts that are not supported by the transcript or notes.',
    '',
    'Typed meeting notes:',
    trimmedNotes,
  ].join('\n');
}
