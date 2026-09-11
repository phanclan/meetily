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
 * One start request may reach more than one live listener: React Strict Mode,
 * HMR, and route changes all re-subscribe, and the old subscription outlives the
 * new one for a tick. The guard therefore lives at module scope so it survives
 * both listener teardown and a provider remount; the handler claims it
 * synchronously, before its first await, so a second delivery cannot slip past.
 */
let startRequestInFlight = false;

const noop = () => {};

/**
 * Handles global recording start requests so tray, sidebar, and banners all
 * share the same start flow without relying on route navigation or sessionStorage.
 */
export function RecordingStartProvider({
  children,
  isOnboardingVisible,
}: RecordingStartProviderProps) {
  const recordingState = useRecordingState();
  const { handleRecordingStart } = useRecordingStart(
    recordingState.isRecording,
    noop,
  );

  // The listener is registered once, so everything it reads comes from here.
  const latest = useRef({ handleRecordingStart, isOnboardingVisible, recordingState });
  latest.current = { handleRecordingStart, isOnboardingVisible, recordingState };

  // A live or starting session keeps the claim; anything else releases it so a
  // later, genuine request is never blocked by a start that has already settled.
  useEffect(() => {
    if (recordingState.isRecording) return;
    if (recordingState.status === RecordingStatus.STARTING) return;
    startRequestInFlight = false;
  }, [recordingState.isRecording, recordingState.status]);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let cancelled = false;

    const setupListener = async () => {
      try {
        unlistenFn = await listen<RecordingStartRequestPayload>(
          'request-recording-start',
          async () => {
            const { handleRecordingStart, isOnboardingVisible, recordingState } = latest.current;

            if (isOnboardingVisible) {
              toast.error('Please complete setup first', {
                description:
                  'You need to finish onboarding before you can start recording.',
              });
              return;
            }

            if (
              startRequestInFlight ||
              recordingState.isRecording ||
              recordingState.status === RecordingStatus.STARTING
            ) {
              return;
            }

            startRequestInFlight = true;

            try {
              await handleRecordingStart();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              toast.error('Failed to start recording', { description: message });
            } finally {
              // Release only when no session took ownership. A start that reached
              // native capture keeps the claim until the session ends, which is
              // what stops a queued duplicate from restarting it.
              const { isRecording, status } = latest.current.recordingState;
              if (
                !isRecording &&
                status !== RecordingStatus.STARTING &&
                status !== RecordingStatus.RECORDING
              ) {
                startRequestInFlight = false;
              }
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
  }, []);

  return <>{children}</>;
}
