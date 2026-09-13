'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import {
  bootstrapCallDetection,
  dismissCallDetection,
  getCallDetectionState,
  getServerCallDetectionState,
  noteCallDetectionRecordingStarted,
  setCallDetectionEnabledPref,
  subscribeCallDetection,
  teardownCallDetection,
} from '@/lib/callDetectionStore';

export function useCallDetection() {
  const snapshot = useSyncExternalStore(
    subscribeCallDetection,
    getCallDetectionState,
    getServerCallDetectionState,
  );

  return {
    ...snapshot,
    setEnabled: setCallDetectionEnabledPref,
    dismiss: dismissCallDetection,
  };
}

/** Always-mounted: preference sync, event listen, recording-started note. Banner is view-only. */
export function CallDetectionRuntime() {
  const { status } = useRecordingState();
  const isRecording = status === RecordingStatus.RECORDING || status === RecordingStatus.STARTING;

  useEffect(() => {
    void bootstrapCallDetection().catch(error => {
      console.error('[CallDetection] Failed to sync or listen:', error);
    });
    return () => teardownCallDetection();
  }, []);

  useEffect(() => {
    if (isRecording) noteCallDetectionRecordingStarted();
  }, [isRecording]);

  return null;
}
