'use client';

import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { safelyUnlisten } from '@/lib/tauriEvents';

interface CallDetectedPayload {
  app_name: string;
}

interface CallDetectionBannerProps {
  onStartRecording?: () => void;
}

export function CallDetectionBanner({ onStartRecording }: CallDetectionBannerProps) {
  const [detectedApp, setDetectedApp] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { status } = useRecordingState();

  const isRecording = status === RecordingStatus.RECORDING || status === RecordingStatus.STARTING;

  useEffect(() => {
    const unlistenDetected = listen<CallDetectedPayload>('call-detected', event => {
      setDetectedApp(event.payload.app_name);
      setDismissed(false);
    });

    const unlistenEnded = listen('call-ended', () => {
      setDetectedApp(null);
    });

    return () => {
      unlistenDetected.then(fn => safelyUnlisten(fn, 'call-detected'));
      unlistenEnded.then(fn => safelyUnlisten(fn, 'call-ended'));
    };
  }, []);

  // Auto-dismiss when recording starts
  useEffect(() => {
    if (isRecording) {
      setDetectedApp(null);
    }
  }, [isRecording]);

  if (!detectedApp || dismissed || isRecording) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 bg-blue-600 text-white text-sm z-50">
      <div className="flex items-center gap-2">
        <span>📞</span>
        <span>
          <span className="font-medium">{detectedApp}</span> detected — want to record this call?
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {onStartRecording && (
          <button
            onClick={() => {
              setDetectedApp(null);
              onStartRecording();
            }}
            className="px-3 py-0.5 bg-white text-blue-600 rounded font-medium text-xs hover:bg-blue-50 transition-colors"
          >
            Start Recording
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="text-blue-200 hover:text-white transition-colors"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
