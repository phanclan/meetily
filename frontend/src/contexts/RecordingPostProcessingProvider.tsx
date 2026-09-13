'use client';

import React, { useEffect, useRef } from 'react';
import { safelyUnlisten } from '@/lib/tauriEvents';
import { listen } from '@tauri-apps/api/event';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import {
  consumeRecordingStopOptions,
  registerRecordingStopHandler,
} from '@/lib/recordingStopOrchestrator';

/**
 * Single post-stop owner. UI and tray only request native stop; this provider
 * runs save, navigation, and `onSaved`.
 *
 * - Tray / keyboard: `recording-stop-complete` from Rust
 * - Recording workspace: `requestRecordingPostStop` after `stop_recording`
 */
export function RecordingPostProcessingProvider({ children }: { children: React.ReactNode }) {
  const setIsRecording = () => { };
  const setIsRecordingDisabled = () => { };

  const {
    handleRecordingStop,
  } = useRecordingStop(setIsRecording, setIsRecordingDisabled);

  const handlerRef = useRef(handleRecordingStop);
  handlerRef.current = handleRecordingStop;

  useEffect(() => {
    registerRecordingStopHandler((complete, options) => handlerRef.current(complete, options));
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlistenFn = await listen<boolean>('recording-stop-complete', (event) => {
          console.log('[RecordingPostProcessing] Received recording-stop-complete event:', event.payload);
          void handlerRef.current(event.payload, consumeRecordingStopOptions());
        });

        if (cancelled) safelyUnlisten(unlistenFn, 'post-processing');
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up event listener:', error);
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      registerRecordingStopHandler(null);
      safelyUnlisten(unlistenFn, 'post-processing');
    };
  }, []);

  return <>{children}</>;
}
