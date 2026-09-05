'use client';

export function createQuickNotePath() {
  return `/quick-note?fresh=${Date.now()}`;
}

export function createDraftNotePath() {
  return '/quick-note';
}

export function createRecordingWorkspacePath(isRecording: boolean) {
  return isRecording ? '/quick-note' : createQuickNotePath();
}
