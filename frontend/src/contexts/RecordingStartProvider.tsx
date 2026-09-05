'use client';

import React, { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { safelyUnlisten } from '@/lib/tauriEvents';

interface RecordingStartRequestPayload {
  source?: string;
}

interface RecordingStartProviderProps {
  children: React.ReactNode;
  isOnboardingVisible: boolean;
}

/**
 * Handles global recording start requests so tray, sidebar, and banners all
 * share the same start flow without relying on route navigation or sessionStorage.
 */
export function RecordingStartProvider({
  children,
  isOnboardingVisible,
}: RecordingStartProviderProps) {
  const recordingState = useRecordingState();
  const startRequestInFlightRef = useRef(false);
  const noop = () => {};
  const { handleRecordingStart } = useRecordingStart(
    recordingState.isRecording,
    noop,
  );

  useEffect(() => {
    if (recordingState.status !== RecordingStatus.STARTING) {
      startRequestInFlightRef.current = false;
    }
  }, [recordingState.status]);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let cancelled = false;

    const setupListener = async () => {
      try {
        unlistenFn = await listen<RecordingStartRequestPayload>(
          'request-recording-start',
          async (event) => {
            if (isOnboardingVisible) {
              toast.error('Please complete setup first', {
                description:
                  'You need to finish onboarding before you can start recording.',
              });
              return;
            }

            if (
              startRequestInFlightRef.current ||
              recordingState.isRecording ||
              recordingState.status === RecordingStatus.STARTING
            ) {
              return;
            }

            startRequestInFlightRef.current = true;

            try {
              await handleRecordingStart();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              toast.error('Failed to start recording', { description: message });
            } finally {
              startRequestInFlightRef.current = false;
            }
          },
        );
        if (cancelled) safelyUnlisten(unlistenFn, 'recording-start-provider');
      } catch (error) {
        console.error(
          '[RecordingStartProvider] Failed to set up event listener:',
          error,
        );
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      safelyUnlisten(unlistenFn, 'recording-start-provider');
    };
  }, [
    handleRecordingStart,
    isOnboardingVisible,
    recordingState.isRecording,
    recordingState.status,
  ]);

  return <>{children}</>;
}
