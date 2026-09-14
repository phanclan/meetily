'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { recordingService } from '@/services/recordingService';

/**
 * Recording state synchronized with backend
 * This context provides a single source of truth for recording state
 * that automatically syncs with the Rust backend, solving:
 * 1. Page refresh desync (backend recording but UI shows stopped)
 * 2. Pause state visibility across components
 * 3. Comprehensive state for future features (reconnection, etc.)
 */

// Recording lifecycle status enum
export enum RecordingStatus {
  IDLE = 'idle',                          // Not recording
  STARTING = 'starting',                  // Initiating recording
  RECORDING = 'recording',                // Active recording
  STOPPING = 'stopping',                  // Stop initiated, waiting for backend
  PROCESSING_TRANSCRIPTS = 'processing',  // Transcription completion wait
  SAVING = 'saving',                      // Saving to database
  COMPLETED = 'completed',                // Successfully saved
  ERROR = 'error'                         // Error occurred
}

interface RecordingLifecycleState {
  isRecording: boolean;
  isPaused: boolean;
  isActive: boolean;
  status: RecordingStatus;
  statusMessage?: string;
}

export interface RecordingDurationSnapshot {
  recordingDuration: number | null;
  activeDuration: number | null;
}

interface RecordingStateContextType extends RecordingLifecycleState {
  setStatus: (status: RecordingStatus, message?: string) => void;
  isStopping: boolean;
  isProcessing: boolean;
  isSaving: boolean;
}

const RecordingStateContext = createContext<RecordingStateContextType | null>(null);

const EMPTY_DURATION: RecordingDurationSnapshot = {
  recordingDuration: null,
  activeDuration: null,
};

let durationSnapshot: RecordingDurationSnapshot = EMPTY_DURATION;
const durationListeners = new Set<() => void>();

function subscribeRecordingDuration(listener: () => void) {
  durationListeners.add(listener);
  return () => {
    durationListeners.delete(listener);
  };
}

function getRecordingDurationSnapshot() {
  return durationSnapshot;
}

function setRecordingDurationSnapshot(next: RecordingDurationSnapshot) {
  if (
    durationSnapshot.recordingDuration === next.recordingDuration &&
    durationSnapshot.activeDuration === next.activeDuration
  ) {
    return;
  }
  durationSnapshot = next;
  durationListeners.forEach(listener => listener());
}

export const useRecordingState = () => {
  const context = useContext(RecordingStateContext);
  if (!context) {
    throw new Error('useRecordingState must be used within a RecordingStateProvider');
  }
  return context;
};

/** Timer display only. Duration ticks must not re-render the rest of the tree. */
export function useRecordingDuration() {
  return useSyncExternalStore(
    subscribeRecordingDuration,
    getRecordingDurationSnapshot,
    getRecordingDurationSnapshot,
  );
}

function lifecycleChanged(prev: RecordingLifecycleState, next: RecordingLifecycleState) {
  return prev.isRecording !== next.isRecording
    || prev.isPaused !== next.isPaused
    || prev.isActive !== next.isActive
    || prev.status !== next.status
    || prev.statusMessage !== next.statusMessage;
}

export function RecordingStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RecordingLifecycleState>({
    isRecording: false,
    isPaused: false,
    isActive: false,
    status: RecordingStatus.IDLE,
    statusMessage: undefined,
  });

  const revision = useRef(0);
  const mounted = useRef(true);
  const polling = useRef(false);

  const setStatus = useCallback((status: RecordingStatus, message?: string) => {
    revision.current += 1;
    setState(prev => (prev.status === status && prev.statusMessage === message
      ? prev
      : { ...prev, status, statusMessage: message }));
  }, []);

  const syncWithBackend = useCallback(async (): Promise<void> => {
    if (!mounted.current || polling.current) return;
    polling.current = true;
    const readRevision = revision.current;
    try {
      const backend = await recordingService.getRecordingState();
      if (!mounted.current || revision.current !== readRevision) return;
      setRecordingDurationSnapshot({
        recordingDuration: backend.recording_duration,
        activeDuration: backend.active_duration,
      });
      setState(prev => {
        if (revision.current !== readRevision) return prev;
        const stopping = [
          RecordingStatus.STOPPING,
          RecordingStatus.PROCESSING_TRANSCRIPTS,
          RecordingStatus.SAVING,
        ].includes(prev.status);
        if (stopping && backend.is_recording) return prev;
        const status = stopping ? prev.status : backend.is_recording ? RecordingStatus.RECORDING
          : prev.status === RecordingStatus.RECORDING ? RecordingStatus.STOPPING : prev.status;
        const next: RecordingLifecycleState = {
          isRecording: backend.is_recording,
          isPaused: backend.is_paused,
          isActive: backend.is_active,
          status,
          statusMessage: status === prev.status ? prev.statusMessage
            : status === RecordingStatus.STOPPING ? 'Stopping recording...' : undefined,
        };
        return lifecycleChanged(prev, next) ? next : prev;
      });
    } catch (error) {
      if (mounted.current && revision.current === readRevision) {
        console.error('[RecordingStateContext] Failed to sync with backend:', error);
      }
    } finally {
      polling.current = false;
      if (mounted.current && revision.current !== readRevision) void syncWithBackend();
    }
  }, []);

  useEffect(() => {
    if (state.status !== RecordingStatus.STARTING && !state.isRecording) return;
    void syncWithBackend();
    const timer = setInterval(() => { void syncWithBackend(); }, 500);
    return () => clearInterval(timer);
  }, [state.status, state.isRecording, syncWithBackend]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const unsubscribers: (() => void)[] = [];

    const track = (unlisten: () => void) => { if (disposed) unlisten(); else unsubscribers.push(unlisten); };
    const setupListeners = async () => {
      try {
        const unlistenStarted = await recordingService.onRecordingStarted(() => {
          if (disposed) return;
          revision.current += 1;
          setState(prev => ({
            ...prev,
            isRecording: true,
            isPaused: false,
            isActive: true,
            status: RecordingStatus.RECORDING,
            statusMessage: undefined,
          }));
        });
        track(unlistenStarted);

        const unlistenStopped = await recordingService.onRecordingStopped(() => {
          if (disposed) return;
          revision.current += 1;
          setRecordingDurationSnapshot(EMPTY_DURATION);
          setState(prev => {
            const newStatus = [
              RecordingStatus.STOPPING,
              RecordingStatus.PROCESSING_TRANSCRIPTS,
              RecordingStatus.SAVING,
            ].includes(prev.status)
              ? prev.status
              : RecordingStatus.STOPPING;

            return {
              ...prev,
              status: newStatus,
              statusMessage: newStatus === RecordingStatus.STOPPING ? 'Stopping recording...' : prev.statusMessage,
              isRecording: false,
              isPaused: false,
              isActive: false,
            };
          });
        });
        track(unlistenStopped);

        const unlistenPaused = await recordingService.onRecordingPaused(() => {
          if (disposed) return;
          revision.current += 1;
          setState(prev => ({
            ...prev,
            isPaused: true,
            isActive: false,
          }));
        });
        track(unlistenPaused);

        const unlistenResumed = await recordingService.onRecordingResumed(() => {
          if (disposed) return;
          revision.current += 1;
          setState(prev => ({
            ...prev,
            isPaused: false,
            isActive: true,
          }));
        });
        track(unlistenResumed);
      } catch (error) {
        console.error('[RecordingStateContext] Failed to set up event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      disposed = true;
      mounted.current = false;
      revision.current += 1;
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  useEffect(() => {
    void syncWithBackend();
  }, [syncWithBackend]);

  const contextValue = useMemo(() => ({
    ...state,
    setStatus,
    isStopping: state.status === RecordingStatus.STOPPING,
    isProcessing: state.status === RecordingStatus.PROCESSING_TRANSCRIPTS,
    isSaving: state.status === RecordingStatus.SAVING,
  }), [state, setStatus]);

  return (
    <RecordingStateContext.Provider value={contextValue}>
      {children}
    </RecordingStateContext.Provider>
  );
}
