'use client';

export function createQuickNotePath() {
  return `/quick-note?fresh=${Date.now()}`;
}

export function createRecordingWorkspacePath(isRecording: boolean) {
  return isRecording ? '/quick-note' : createQuickNotePath();
}
