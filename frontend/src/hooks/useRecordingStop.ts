import { useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { storageService } from '@/services/storageService';
import { transcriptService } from '@/services/transcriptService';
import Analytics from '@/lib/analytics';
import { readLiveMeetingNotes, clearLiveMeetingNotes } from '@/lib/liveMeetingNotes';
import { blocksToPlainText } from '@/lib/meetingNotes';
import { saveMeetingNotes } from '@/afterword/ipc';
import { clearLiveMeetingFolder, saveLiveMeetingFolder } from '@/lib/liveMeetingFolder';
import { readResumeSequenceScope, selectResumedTranscripts } from '@/lib/transcriptSequence';
import { resolvePersistedMeetingTitle } from '@/lib/meetingTitle';
import { invoke } from '@tauri-apps/api/core';
import {
  clearLiveSessionId,
  clearResumeIdentity,
  readAppendTargetMeetingId,
  readLiveSessionId,
  readResumeBaselineCount,
} from '@/lib/recordingSessionIdentity';
import { createSavedNotePath } from '@/lib/savedNoteRoute';
import type { RecordingStopOptions } from '@/lib/recordingStopOrchestrator';
import {
  applyPinnedSummaryLanguageToMeeting,
  detectAndCacheSummaryLanguage,
} from '@/lib/summary-language-preferences';

export type { RecordingStopOptions } from '@/lib/recordingStopOrchestrator';

// Rust's `stop_recording` only returns after every queued chunk has been transcribed, so
// the frontend just has to let the last `transcript-update` events land in React state.
// These bound that wait instead of sleeping for a fixed several seconds.
const TRANSCRIPT_SETTLE_POLL_MS = 50;
const TRANSCRIPT_SETTLE_STABLE_POLLS = 2;
const TRANSCRIPT_SETTLE_TIMEOUT_MS = 2000;

/**
 * Wait until the transcript count stops changing (or the timeout elapses).
 * Returns as soon as the count is stable, so the normal case costs ~100ms rather than
 * the fixed 4.5s of sleeps this replaced.
 */
async function waitForTranscriptsToSettle(getCount: () => number): Promise<number> {
  const deadline = Date.now() + TRANSCRIPT_SETTLE_TIMEOUT_MS;
  let previousCount = -1;
  let stablePolls = 0;

  while (Date.now() < deadline) {
    const count = getCount();
    if (count === previousCount) {
      stablePolls += 1;
      if (stablePolls >= TRANSCRIPT_SETTLE_STABLE_POLLS) {
        return count;
      }
    } else {
      stablePolls = 0;
      previousCount = count;
    }
    await new Promise(resolve => setTimeout(resolve, TRANSCRIPT_SETTLE_POLL_MS));
  }

  return getCount();
}

type SummaryStatus = 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';

interface UseRecordingStopReturn {
  handleRecordingStop: (callApi: boolean, options?: RecordingStopOptions) => Promise<string | undefined>;
  isStopping: boolean;
  isProcessingTranscript: boolean;
  isSavingTranscript: boolean;
  summaryStatus: SummaryStatus;
  setIsStopping: (value: boolean) => void;
}

// Shared across the orchestrator instance so UI + tray cannot double-save.
let stopProcessing = false;

/**
 * Custom hook for managing recording stop lifecycle.
 * Handles the complex stop sequence: transcription wait → buffer flush → SQLite save → navigation.
 *
 * Features:
 * - Transcription completion confirmation (bounded 5s safety net, 250ms interval)
 * - Transcript buffer flush coordination
 * - SQLite meeting save with folder_path from sessionStorage
 * - Comprehensive analytics tracking (duration, word count, activation)
 * - Auto-navigation to the flavor's saved-note surface
 * - Toast notifications for success/error
 */
export function useRecordingStop(
  setIsRecording: (value: boolean) => void,
  setIsRecordingDisabled: (value: boolean) => void
): UseRecordingStopReturn {
  // USE global state instead
  const recordingState = useRecordingState();
  const {
    status,
    setStatus,
    isStopping,
    isProcessing: isProcessingTranscript,
    isSaving: isSavingTranscript
  } = recordingState;

  const {
    currentMeetingId,
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    setMeetingTitle,
    markMeetingAsSaved,
  } = useTranscripts();

  const {
    refetchMeetings,
    setCurrentMeeting,
    setMeetings,
    meetings,
    setIsMeetingActive,
  } = useSidebar();

  const router = useRouter();

  // Guard to prevent duplicate/concurrent stop calls (e.g., from UI and tray simultaneously)
  // Coordination is shared across hook instances through stopProcessing.

  // Promise to track recording-stopped event data (fixes race condition with recording-stop-complete)
  const recordingStoppedDataRef = useRef<Promise<void> | null>(null);

  // Set up recording-stopped listener for meeting navigation
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupRecordingStoppedListener = async () => {
      try {
        console.log('Setting up recording-stopped listener for navigation...');
        unlistenFn = await listen<{
          message: string;
          folder_path?: string;
          meeting_name?: string;
        }>('recording-stopped', async (event) => {
          // Create promise that resolves when sessionStorage is set (prevents race condition)
          recordingStoppedDataRef.current = (async () => {
            const { folder_path, meeting_name } = event.payload;

            // Store folder_path and meeting_name for later use in handleRecordingStop
            if (folder_path) {
              sessionStorage.setItem('last_recording_folder_path', folder_path);
            }
            if (meeting_name) {
              sessionStorage.setItem('last_recording_meeting_name', meeting_name);
            }
          })();

        });
        console.log('Recording stopped listener setup complete');
      } catch (error) {
        console.error('Failed to setup recording stopped listener:', error);
      }
    };

    setupRecordingStoppedListener();

    return () => {
      console.log('Cleaning up recording stopped listener...');
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [router]);

  // Main recording stop handler
  const handleRecordingStop = useCallback(async (isCallApi: boolean, options: RecordingStopOptions = {}) => {
    let savedId: string | undefined;
    if (recordingStoppedDataRef.current) {
      await recordingStoppedDataRef.current;
    }

    // Guard: prevent duplicate/concurrent stop calls
    if (stopProcessing) {
      return;
    }
    stopProcessing = true;

    // Set status to STOPPING immediately
    setStatus(RecordingStatus.STOPPING);
    setIsRecording(false);
    setIsRecordingDisabled(true);
    const stopStartTime = Date.now();

    try {
      if (!isCallApi) {
        setStatus(RecordingStatus.IDLE);
        setIsMeetingActive(false);
        setIsRecordingDisabled(false);
        return;
      }
      console.log('Post-stop processing (new implementation)...', {
        stop_initiated_at: new Date(stopStartTime).toISOString(),
        current_transcript_count: transcriptsRef.current.length
      });

      // Note: stop_recording is already called by RecordingControls.stopRecordingAction
      // This function only handles post-stop processing (transcription wait, API call, navigation)
      console.log('Recording already stopped by RecordingControls, processing transcription...');

      // Confirm transcription is finished.
      //
      // Rust's stop_recording awaits the whole transcription task before it returns, and
      // both callers await it before calling this handler, so this is a confirmation
      // rather than a wait. (The old code also listened for a `transcription-complete`
      // event that only dead Rust code ever emitted, then slept unconditionally.)
      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Finishing transcription...');

      const MAX_WAIT_TIME = 5000; // Safety net only - the native stop already drained the queue
      const POLL_INTERVAL = 250;
      let elapsedTime = 0;
      let transcriptionComplete = false;

      while (elapsedTime < MAX_WAIT_TIME) {
        try {
          const status = await transcriptService.getTranscriptionStatus();

          if (!status.is_processing && status.chunks_in_queue === 0) {
            transcriptionComplete = true;
            break;
          }

          console.log(`Processing ${status.chunks_in_queue} remaining audio chunks...`);
          setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, `Processing ${status.chunks_in_queue} remaining chunks...`);
        } catch (error) {
          console.error('Error checking transcription status:', error);
          break;
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        elapsedTime += POLL_INTERVAL;
      }

      if (!transcriptionComplete) {
        console.warn('⚠️ Native transcription status never reported an idle queue after', elapsedTime, 'ms - saving anyway');
      }

      // Final buffer flush: process ALL remaining transcripts regardless of timing
      const flushStartTime = Date.now();
      console.log('🔄 Final buffer flush: forcing processing of any remaining transcripts...', {
        flush_started_at: new Date(flushStartTime).toISOString(),
        time_since_stop: flushStartTime - stopStartTime,
        current_transcript_count: transcriptsRef.current.length
      });
      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Flushing transcript buffer...');
      flushBuffer();

      // React state (and therefore transcriptsRef) updates asynchronously, and a late
      // segment can still arrive. Wait for the count to stop moving instead of sleeping.
      await waitForTranscriptsToSettle(() => transcriptsRef.current.length);

      const flushEndTime = Date.now();
      console.log('✅ Final buffer flush completed', {
        flush_duration: flushEndTime - flushStartTime,
        total_time_since_stop: flushEndTime - stopStartTime,
        final_transcript_count: transcriptsRef.current.length
      });

      // NOTE: Status remains PROCESSING_TRANSCRIPTS until we start saving

      // Save to SQLite.
      // The meeting is ALWAYS persisted when the native stop reported a usable recording.
      // An unconfirmed transcription status warns the user; it never silently skips the
      // save, which used to leave the meeting only in IndexedDB for manual recovery.
      if (isCallApi) {
        if (!transcriptionComplete) {
          toast.warning('Transcript may be incomplete', {
            description: 'The meeting was saved, but transcription did not report a clean finish.',
          });
        }

        setStatus(RecordingStatus.SAVING, 'Saving meeting to database...');

        // Get fresh transcript state (ALL transcripts including late ones)
        const freshTranscripts = [...transcriptsRef.current];

        // Get folder_path and meeting_name from recording-stopped event
        const folderPath = sessionStorage.getItem('last_recording_folder_path');
        const savedMeetingName = sessionStorage.getItem('last_recording_meeting_name');

        console.log('💾 Saving COMPLETE transcripts to database...', {
          transcript_count: freshTranscripts.length,
          meeting_name: savedMeetingName || meetingTitle,
          folder_path: folderPath,
          sample_text: freshTranscripts.length > 0 ? freshTranscripts[0].text.substring(0, 50) + '...' : 'none',
          last_transcript: freshTranscripts.length > 0 ? freshTranscripts[freshTranscripts.length - 1].text.substring(0, 30) + '...' : 'none',
        });

        try {
          const liveId = currentMeetingId || readLiveSessionId();
          const appendToMeetingId = options.appendToMeetingId || readAppendTargetMeetingId() || undefined;
          const baseline = typeof options.resumeBaselineCount === 'number'
            ? options.resumeBaselineCount
            : readResumeBaselineCount();
          const transcriptsToPersist = appendToMeetingId
            ? selectResumedTranscripts(freshTranscripts, baseline, readResumeSequenceScope())
            : freshTranscripts;

          let meetingId: string;
          if (appendToMeetingId) {
            await storageService.appendMeetingTranscripts(appendToMeetingId, transcriptsToPersist);
            meetingId = appendToMeetingId;
            const liveNotes = liveId ? readLiveMeetingNotes(liveId) : null;
            const sourceText = [
              liveNotes ? blocksToPlainText(liveNotes) : '',
              ...transcriptsToPersist.map(item => item.text || ''),
            ].filter(Boolean).join('\n');
            const persistedTitle = resolvePersistedMeetingTitle({
              uiTitle: meetingTitle,
              sessionTitle: savedMeetingName,
              savedMeetingName,
              sourceText,
            });
            if (persistedTitle && persistedTitle !== meetingTitle) {
              setMeetingTitle(persistedTitle);
              await invoke('api_save_meeting_title', { meetingId, title: persistedTitle }).catch(error => {
                console.warn('Failed to persist derived meeting title after resume:', error);
              });
            }
            clearResumeIdentity();
          } else {
            const liveNotes = liveId ? readLiveMeetingNotes(liveId) : null;
            const sourceText = [
              liveNotes ? blocksToPlainText(liveNotes) : '',
              ...transcriptsToPersist.map(item => item.text || ''),
            ].filter(Boolean).join('\n');
            const persistedTitle = resolvePersistedMeetingTitle({
              uiTitle: meetingTitle,
              sessionTitle: savedMeetingName,
              savedMeetingName,
              sourceText,
            });
            if (persistedTitle && persistedTitle !== meetingTitle) {
              setMeetingTitle(persistedTitle);
            }
            const responseData = await storageService.saveMeeting(
              persistedTitle,
              transcriptsToPersist,
              folderPath,
              liveId,
            );
            meetingId = responseData.meeting_id;
            if (!meetingId) {
              console.error('No meeting_id in response:', responseData);
              throw new Error('No meeting ID received from save operation');
            }
          }

          const liveNotes = liveId ? readLiveMeetingNotes(liveId) : null;
          if (liveNotes !== null) {
            await saveMeetingNotes({
              meetingId,
              notesMarkdown: blocksToPlainText(liveNotes),
              notesJson: JSON.stringify(liveNotes),
            });
          }
          // Folder membership must be confirmed before discarding retry data.
          const noteFolderId = await saveLiveMeetingFolder(liveId, meetingId);
          const meetingPath = createSavedNotePath(meetingId, {
            folderId: noteFolderId,
            source: 'recording',
          });
          await options.onSaved?.(meetingId);
          if (liveId) clearLiveMeetingNotes(liveId);
          savedId = meetingId;

          let shouldDetectSummaryLanguage = false;
          try {
            shouldDetectSummaryLanguage = !(await applyPinnedSummaryLanguageToMeeting(meetingId));
          } catch (error) {
            console.warn('Failed to apply pinned summary language preference for new meeting:', error);
            toast.warning('Could not apply default summary language', {
              description: 'The meeting was saved, but the default summary language was not applied.',
            });
          }

          if (shouldDetectSummaryLanguage) {
            try {
              await detectAndCacheSummaryLanguage(
                meetingId,
                freshTranscripts.map(t => t.text)
              );
            } catch (error) {
              console.warn('Failed to detect summary language for new meeting:', error);
              toast.warning('Could not detect summary language', {
                description: 'The meeting was saved, but Auto could not detect the summary language.',
              });
            }
          }

          console.log('✅ Successfully saved COMPLETE meeting with ID:', meetingId);
          console.log('   Transcripts:', freshTranscripts.length);
          console.log('   folder_path:', folderPath);

          // Mark meeting as saved in IndexedDB (for recovery system)
          await markMeetingAsSaved();
          if (liveId) clearLiveMeetingFolder(liveId);

          // Clean up session storage
          sessionStorage.removeItem('last_recording_folder_path');
          sessionStorage.removeItem('last_recording_meeting_name');
          clearLiveSessionId();

          // Refetch meetings and set current meeting
          await refetchMeetings();

          try {
            const meetingData = await storageService.getMeeting(meetingId);
            if (meetingData) {
              setCurrentMeeting({
                id: meetingId,
                title: meetingData.title
              });
              console.log('✅ Current meeting set:', meetingData.title);
            }
          } catch (error) {
            console.warn('Could not fetch meeting details, using ID only:', error);
            setCurrentMeeting({ id: meetingId, title: savedMeetingName || meetingTitle || 'New Meeting' });
          }

          // Mark as completed
          setStatus(RecordingStatus.COMPLETED);

          // Show success toast with navigation option
          if (options.showToast !== false) toast.success('Recording saved successfully!', {
            description: `${freshTranscripts.length} transcript segments saved.`,
            action: {
              label: 'View Meeting',
              onClick: () => {
                router.push(meetingPath);
                Analytics.trackButtonClick('view_meeting_from_toast', 'recording_complete');
              }
            },
            duration: 10000,
          });

          // Navigate immediately - everything this page was waiting for is already saved.
          if (options.autoNavigate !== false) {
            router.push(meetingPath);
            clearTranscripts();
            Analytics.trackPageView('meeting_details');

            // Reset to IDLE after navigation
            setStatus(RecordingStatus.IDLE);
          }
          // Track meeting completion analytics
          try {
            // Calculate meeting duration from transcript timestamps
            let durationSeconds = 0;
            if (freshTranscripts.length > 0 && freshTranscripts[0].audio_start_time !== undefined) {
              // Use audio_end_time of last transcript if available
              const lastTranscript = freshTranscripts[freshTranscripts.length - 1];
              durationSeconds = lastTranscript.audio_end_time || lastTranscript.audio_start_time || 0;
            }

            // Calculate word count
            const transcriptWordCount = freshTranscripts
              .map(t => t.text.split(/\s+/).length)
              .reduce((a, b) => a + b, 0);

            // Calculate words per minute
            const wordsPerMinute = durationSeconds > 0 ? transcriptWordCount / (durationSeconds / 60) : 0;

            // Get meetings count today
            const meetingsToday = await Analytics.getMeetingsCountToday();

            // Track meeting completed
            await Analytics.trackMeetingCompleted(meetingId, {
              duration_seconds: durationSeconds,
              transcript_segments: freshTranscripts.length,
              transcript_word_count: transcriptWordCount,
              words_per_minute: wordsPerMinute,
              meetings_today: meetingsToday
            });

            // Update meeting count in analytics.json
            await Analytics.updateMeetingCount();

            // Check for activation (first meeting)
            const { Store } = await import('@tauri-apps/plugin-store');
            const store = await Store.load('analytics.json');
            const totalMeetings = await store.get<number>('total_meetings');

            if (totalMeetings === 1) {
              const daysSinceInstall = await Analytics.calculateDaysSince('first_launch_date');
              await Analytics.track('user_activated', {
                meetings_count: '1',
                days_since_install: daysSinceInstall?.toString() || 'null',
                first_meeting_duration_seconds: durationSeconds.toString()
              });
            }
          } catch (analyticsError) {
            console.error('Failed to track meeting completion analytics:', analyticsError);
            // Don't block user flow on analytics errors
          }

        } catch (saveError) {
          console.error('Failed to save meeting to database:', saveError);
          setStatus(RecordingStatus.ERROR, saveError instanceof Error ? saveError.message : 'Unknown error');
          toast.error('Failed to save meeting', {
            description: saveError instanceof Error ? saveError.message : 'Unknown error'
          });
          throw saveError;
        }
      } else {
        // No save needed, go back to IDLE
        setStatus(RecordingStatus.IDLE);
      }

      setIsMeetingActive(false);
      // isRecording already set to false at function start
      setIsRecordingDisabled(false);
      return savedId;
    } catch (error) {
      console.error('Error in handleRecordingStop:', error);
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Unknown error');
      // isRecording already set to false at function start
      setIsRecordingDisabled(false);
    } finally {
      // Always reset the guard flag when done
      stopProcessing = false;
    }
  }, [
    setIsRecording,
    setIsRecordingDisabled,
    setStatus,
    currentMeetingId,
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    setMeetingTitle,
    markMeetingAsSaved,
    refetchMeetings,
    setCurrentMeeting,
    setMeetings,
    meetings,
    setIsMeetingActive,
    router,
  ]);

  // Derive summaryStatus from RecordingStatus for backward compatibility
  const summaryStatus: SummaryStatus = status === RecordingStatus.PROCESSING_TRANSCRIPTS ? 'processing' : 'idle';

  return {
    handleRecordingStop,
    isStopping,
    isProcessingTranscript,
    isSavingTranscript,
    summaryStatus,
    setIsStopping: (value: boolean) => {
      setStatus(value ? RecordingStatus.STOPPING : RecordingStatus.IDLE);
    },
  };
}
