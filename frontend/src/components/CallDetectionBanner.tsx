'use client';

import Image from 'next/image';
import { X } from 'lucide-react';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { useCallDetection } from '@/hooks/useCallDetection';
import { shouldShowCallDetectionBanner } from '@/lib/callDetectionCopy';

interface CallDetectionBannerProps {
  onStartRecording?: () => void;
}

export function CallDetectionBanner({ onStartRecording }: CallDetectionBannerProps) {
  const { lastDetected, dismissed, announcement, enabled, dismiss } = useCallDetection();
  const { status } = useRecordingState();
  const isRecording = status === RecordingStatus.RECORDING || status === RecordingStatus.STARTING;

  if (!shouldShowCallDetectionBanner({
    enabled,
    lastDetected,
    dismissed,
    isRecording,
    announcement,
  }) || !lastDetected) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="no-drag pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-stone-200/80 bg-stone-50/95 py-1.5 pl-2 pr-1.5 text-sm text-stone-700 shadow-[0_12px_32px_rgba(28,25,23,0.18)] backdrop-blur-xl"
      >
        <Image
          src="/icon_128x128.png"
          alt=""
          aria-hidden
          width={24}
          height={24}
          className="h-6 w-6 shrink-0 rounded-md"
        />
        <p className="min-w-0 truncate whitespace-nowrap">
          <span className="font-semibold text-stone-900">{lastDetected}</span>
          {announcement === 'running' ? ' meeting still active. Record?' : ' meeting. Record?'}
        </p>
        {onStartRecording && (
          <button
            type="button"
            onClick={() => {
              onStartRecording();
            }}
            className="shrink-0 rounded-full bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2"
          >
            Record
          </button>
        )}
        <button
          type="button"
          onClick={() => dismiss()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500"
          aria-label="Dismiss call detection"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
