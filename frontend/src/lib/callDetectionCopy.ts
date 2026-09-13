export type CallDetectionAnnouncement = 'detected' | 'running';

export type CallDetectionView = {
  enabled: boolean;
  lastDetected: string | null;
  dismissed: boolean;
  isRecording: boolean;
  announcement: CallDetectionAnnouncement;
};

/** Hide while recording; do not clear last-detected. */
export function shouldShowCallDetectionBanner(view: CallDetectionView): boolean {
  return Boolean(view.enabled && view.lastDetected && !view.dismissed && !view.isRecording);
}

export function callDetectionBannerCopy(
  appName: string,
  announcement: CallDetectionAnnouncement,
): string {
  if (announcement === 'running') {
    return `${appName} is running. Record?`;
  }
  return `${appName} detected. Record?`;
}

/**
 * After Stop, the same conferencing app is not a fresh detection.
 * A different app (or first sighting) may still announce as "detected".
 */
export function announcementAfterRecordStop(opts: {
  appStillPresent: string | null;
  appWhenRecordingStarted: string | null;
}): CallDetectionAnnouncement {
  if (opts.appStillPresent && opts.appStillPresent === opts.appWhenRecordingStarted) {
    return 'running';
  }
  return 'detected';
}

export function shouldAnnounceCall(opts: {
  isRecording: boolean;
  previousApp: string | null;
  nextApp: string | null;
}): boolean {
  if (opts.isRecording || !opts.nextApp) return false;
  return opts.previousApp !== opts.nextApp;
}
