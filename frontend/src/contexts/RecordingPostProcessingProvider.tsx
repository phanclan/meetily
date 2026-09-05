'use client';

import React, { useEffect, useRef } from 'react';
import { safelyUnlisten } from '@/lib/tauriEvents';
import { listen } from '@tauri-apps/api/event';
import { useRecordingStop } from '@/hooks/useRecordingStop';

/**
 * RecordingPostProcessingProvider
 *
 * This provider handles post-processing when recording stops from any source:
 * - Tray menu stop
 * - Global keyboard shortcut
 * - Overlay stop button
 * - Main UI stop button
 *
 * It listens for the 'recording-stop-complete' event from Rust backend
 * and triggers the full post-processing flow (save to database, navigate, analytics)
 * regardless of which page the user is currently on.
 */
export function RecordingPostProcessingProvider({ children }: { children: React.ReactNode }) {
  // No-op functions since the global RecordingStateContext already handles state updates
  // These are only needed for the hook's local component state management
  const setIsRecording = () => { };
  const setIsRecordingDisabled = () => { };

  const {
    handleRecordingStop,
  } = useRecordingStop(setIsRecording, setIsRecordingDisabled);

  const handlerRef = useRef(handleRecordingStop);
  handlerRef.current = handleRecordingStop;

  useEffect(() => {
    const callback = (callApi = true) => handlerRef.current(callApi);
    (window as any).handleRecordingStop = callback;
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        unlistenFn = await listen<boolean>('recording-stop-complete', (event) => {
          console.log('[RecordingPostProcessing] Received recording-stop-complete event:', event.payload);

          // Call the post-processing handler
          // event.payload is the callApi boolean (true for normal stops)
          void handlerRef.current(event.payload);
        });

        if (cancelled) safelyUnlisten(unlistenFn, 'post-processing');
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up event listener:', error);
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      safelyUnlisten(unlistenFn, 'post-processing');
      if ((window as any).handleRecordingStop === callback) {
        delete (window as any).handleRecordingStop;
      }
    };
  }, []);

  return <>{children}</>;
}
