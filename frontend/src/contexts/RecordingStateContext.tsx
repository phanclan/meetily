'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

interface RecordingState {
  isRecording: boolean;           // Is a recording session active
  isPaused: boolean;              // Is the recording paused
  isActive: boolean;              // Is actively recording (recording && !paused)
  recordingDuration: number | null;  // Total duration including pauses
  activeDuration: number | null;     // Active recording time (excluding pauses)

  // NEW: Lifecycle status
  status: RecordingStatus;
  statusMessage?: string;  // Optional message for current status
}

interface RecordingStateContextType extends RecordingState {
  // NEW: Setters for status management
  setStatus: (status: RecordingStatus, message?: string) => void;

  // Computed helpers (derived from status)
  isStopping: boolean;
  isProcessing: boolean;
  isSaving: boolean;
}

const RecordingStateContext = createContext<RecordingStateContextType | null>(null);

export const useRecordingState = () => {
  const context = useContext(RecordingStateContext);
  if (!context) {
    throw new Error('useRecordingState must be used within a RecordingStateProvider');
  }
  return context;
};

export function RecordingStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    isActive: false,
    recordingDuration: null,
    activeDuration: null,
    status: RecordingStatus.IDLE,  // NEW: Initialize with IDLE status
    statusMessage: undefined,       // NEW: No message initially
  });

  const revision = useRef(0);
  const mounted = useRef(true);
  const polling = useRef(false);

  const setStatus = useCallback((status: RecordingStatus, message?: string) => {
    // Invalidate reads dispatched before this lifecycle transition.
    revision.current += 1;
    console.log(`[RecordingState] Status: ${status}`, message || '');
    setState(prev => ({ ...prev, status, statusMessage: message }));
  }, []);

  const syncWithBackend = useCallback(async (): Promise<void> => {
    if (!mounted.current || polling.current) return;
    polling.current = true;
    const readRevision = revision.current;
    try {
      const backend = await recordingService.getRecordingState();
      if (!mounted.current || revision.current !== readRevision) return;
      setState(prev => {
        if (revision.current !== readRevision) return prev;
        // The native capture can end before transcript processing and saving do.
        // Polling must not undo that frontend-owned stop lifecycle.
        const stopping = [RecordingStatus.STOPPING, RecordingStatus.PROCESSING_TRANSCRIPTS, RecordingStatus.SAVING].includes(prev.status);
        if (stopping && backend.is_recording) return prev;
        const status = stopping ? prev.status : backend.is_recording ? RecordingStatus.RECORDING
          : prev.status === RecordingStatus.RECORDING ? RecordingStatus.STOPPING : prev.status;
        const next = {
          ...prev,
          isRecording: backend.is_recording,
          isPaused: backend.is_paused,
          isActive: backend.is_active,
          recordingDuration: backend.recording_duration,
          activeDuration: backend.active_duration,
          status,
          statusMessage: status === prev.status ? prev.statusMessage
            : status === RecordingStatus.STOPPING ? 'Stopping recording...' : undefined,
        };
        return (Object.keys(next) as (keyof RecordingState)[]).every(key => next[key] === prev[key]) ? prev : next;
      });
    } catch (error) {
      if (mounted.current && revision.current === readRevision) console.error('[RecordingStateContext] Failed to sync with backend:', error);
    } finally {
      polling.current = false;
      // Catch up after an event or Strict Mode remount without overlapping IPC.
      if (mounted.current && revision.current !== readRevision) void syncWithBackend();
    }
  }, []);

  // A missed started event must not leave the UI indefinitely at Starting.
  useEffect(() => {
    if (state.status !== RecordingStatus.STARTING && !state.isRecording) return;
    void syncWithBackend();
    const timer = setInterval(() => { void syncWithBackend(); }, 500);
    return () => clearInterval(timer);
  }, [state.status, state.isRecording, syncWithBackend]);

  /**
   * Set up event listeners for backend state changes
   */
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    console.log('[RecordingStateContext] Setting up event listeners');
    const unsubscribers: (() => void)[] = [];

    const track = (unlisten: () => void) => { if (disposed) unlisten(); else unsubscribers.push(unlisten); };
    const setupListeners = async () => {
      try {
        // Recording started
        const unlistenStarted = await recordingService.onRecordingStarted(() => {
          if (disposed) return;
          revision.current += 1;
          console.log('[RecordingStateContext] Recording started event');
          setState(prev => ({
            ...prev,
            isRecording: true,
            isPaused: false,
            isActive: true,
            status: RecordingStatus.RECORDING,  // NEW: Set status to RECORDING
            statusMessage: undefined,
          }));
        });
        track(unlistenStarted);

        // Recording stopped
        const unlistenStopped = await recordingService.onRecordingStopped((payload) => {
          if (disposed) return;
          revision.current += 1;
          console.log('[RecordingStateContext] Recording stopped event:', payload);
          setState(prev => {
            // Set status to STOPPING if not already in stop flow
            // This ensures smooth UI transition for tray/keyboard stops
            const newStatus = [
              RecordingStatus.STOPPING,
              RecordingStatus.PROCESSING_TRANSCRIPTS,
              RecordingStatus.SAVING
            ].includes(prev.status)
              ? prev.status  // Already in stop flow
              : RecordingStatus.STOPPING;  // New stop, transition smoothly

            return {
              ...prev,
              status: newStatus,
              statusMessage: newStatus === RecordingStatus.STOPPING ? 'Stopping recording...' : prev.statusMessage,
              isRecording: false,
              isPaused: false,
              isActive: false,
              recordingDuration: null,
              activeDuration: null,
            };
          });
        });
        track(unlistenStopped);

        // Recording paused
        const unlistenPaused = await recordingService.onRecordingPaused(() => {
          if (disposed) return;
          revision.current += 1;
          console.log('[RecordingStateContext] Recording paused event');
          setState(prev => ({
            ...prev,
            isPaused: true,
            isActive: false,
          }));
        });
        track(unlistenPaused);

        // Recording resumed
        const unlistenResumed = await recordingService.onRecordingResumed(() => {
          if (disposed) return;
          revision.current += 1;
          console.log('[RecordingStateContext] Recording resumed event');
          setState(prev => ({
            ...prev,
            isPaused: false,
            isActive: true,
          }));
        });
        track(unlistenResumed);

        console.log('[RecordingStateContext] Event listeners set up successfully');
      } catch (error) {
        console.error('[RecordingStateContext] Failed to set up event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      disposed = true;
      mounted.current = false;
      revision.current += 1;
      console.log('[RecordingStateContext] Cleaning up event listeners');
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  /**
   * Initial sync on mount - CRITICAL for fixing refresh desync bug
   * If backend is recording but UI state is false, this will correct it
   */
  useEffect(() => {
    console.log('[RecordingStateContext] Initial mount - syncing with backend');
    void syncWithBackend();
  }, [syncWithBackend]);

  // NEW: Computed helpers from status
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
