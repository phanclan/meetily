'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode, MutableRefObject } from 'react';
import { Transcript, TranscriptUpdate } from '@/types';
import { toast } from 'sonner';
import { useRecordingState } from './RecordingStateContext';
import { transcriptService } from '@/services/transcriptService';
import { recordingService } from '@/services/recordingService';
import { indexedDBService } from '@/services/indexedDBService';
import { useRecordingTitle } from '@/hooks/useRecordingTitle';
import { bindRecordingFolder } from '@/lib/liveMeetingFolder';
import { compareTranscriptOrder, transcriptSequenceKey } from '@/lib/transcriptSequence';
import {
  allocateLiveSessionId,
  clearLiveSessionId,
  readAppendTargetMeetingId,
  readLiveSessionId,
  RESUME_SEQUENCE_SCOPE_STORAGE_KEY,
  writeLiveSessionId,
} from '@/lib/recordingSessionIdentity';

interface TranscriptContextType {
  transcripts: Transcript[];
  transcriptsRef: MutableRefObject<Transcript[]>
  addTranscript: (update: TranscriptUpdate) => void;
  copyTranscript: () => void;
  flushBuffer: () => void;
  transcriptContainerRef: React.RefObject<HTMLDivElement | null>;
  meetingTitle: string;
  setMeetingTitle: (title: string) => void;
  clearTranscripts: () => void;
  /** Live capture id (`liveSessionId`). Not notesOwnerId. */
  currentMeetingId: string | null;
  liveSessionId: string | null;
  markMeetingAsSaved: () => Promise<void>;
  beginResumeTranscriptSession: () => void;
  abortResumeTranscriptSession: () => void;
}

const TranscriptContext = createContext<TranscriptContextType | undefined>(undefined);

export function TranscriptProvider({ children }: { children: ReactNode }) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const { meetingTitle, setMeetingTitle, beginSession, syncMeetingTitle } = useRecordingTitle();
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);

  // Recording state context - provides backend-synced state
  const recordingState = useRecordingState();

  // Refs for transcript management
  const transcriptsRef = useRef<Transcript[]>(transcripts);
  const isUserAtBottomRef = useRef<boolean>(true);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const finalFlushRef = useRef<(() => void) | null>(null);

  // Tauri events are not buffered: a listener torn down mid-recording loses every
  // `transcript-update` emitted before the async `listen()` round-trip completes. The
  // event listeners below therefore mount once and read the live meeting id from this
  // ref instead of depending on `currentMeetingId` state.
  const currentMeetingIdRef = useRef<string | null>(null);
  const resetTranscriptBufferRef = useRef<(() => void) | null>(null);
  // Native sessions restart sequence_id at 1. Resume keeps prior segments, so each
  // capture generation needs its own scope or new lines are dropped as duplicates.
  const sequenceScopeRef = useRef(Number(sessionStorage.getItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY) || '0') || 0);

  // Single writer for the meeting id: the ref updates synchronously for listeners, the
  // state update keeps consumers rendering.
  const applyCurrentMeetingId = useCallback(
    (next: string | null | ((previous: string | null) => string | null)) => {
      const value = typeof next === 'function' ? next(currentMeetingIdRef.current) : next;
      currentMeetingIdRef.current = value;
      setCurrentMeetingId(value);
    },
    []
  );

  // Keep ref updated with current transcripts
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  // Smart auto-scroll: Track user scroll position
  useEffect(() => {
    const handleScroll = () => {
      const container = transcriptContainerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px tolerance
      isUserAtBottomRef.current = isAtBottom;
    };

    const container = transcriptContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // Auto-scroll when transcripts change (only if user is at bottom)
  useEffect(() => {
    // Only auto-scroll if user was at the bottom before new content
    if (isUserAtBottomRef.current && transcriptContainerRef.current) {
      // Wait for Framer Motion animation to complete (150ms) before scrolling
      // This ensures scrollHeight includes the full rendered height of the new transcript
      const scrollTimeout = setTimeout(() => {
        const container = transcriptContainerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 150); // Match Framer Motion transition duration

      return () => clearTimeout(scrollTimeout);
    }
  }, [transcripts]);

  // Initialize IndexedDB and listen for recording-started/stopped events
  useEffect(() => {
    let unlistenRecordingStarted: (() => void) | undefined;
    let unlistenRecordingStopped: (() => void) | undefined;

    const setupRecordingListeners = async () => {
      try {
        // Initialize IndexedDB
        await indexedDBService.init();

        // Listen for recording-started event
        unlistenRecordingStarted = await recordingService.onRecordingStarted(async () => {
          try {
            const resumeMeetingId = readAppendTargetMeetingId();
            // Resume keeps prior segments in the buffer; a brand-new session starts empty.
            if (!resumeMeetingId) {
              sequenceScopeRef.current = 0;
              sessionStorage.removeItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY);
              setTranscripts([]);
            } else if (!sessionStorage.getItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY)) {
              sequenceScopeRef.current += 1;
              sessionStorage.setItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY, String(sequenceScopeRef.current));
            } else {
              const storedScope = Number(sessionStorage.getItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY));
              if (Number.isFinite(storedScope)) sequenceScopeRef.current = storedScope;
            }
            // The main listener now outlives a single meeting, so its sequence buffer has
            // to be cleared here instead of by a remount.
            resetTranscriptBufferRef.current?.();
            beginSession();
            // Live capture id only. Resume still gets a fresh live id for IndexedDB
            // recovery; notes stay on notesOwnerId (append target / persisted meeting).
            const meetingId = allocateLiveSessionId();
            bindRecordingFolder(meetingId);

            writeLiveSessionId(meetingId);
            console.log('[Recording Started] 💾 IndexedDB meeting ID stored:', meetingId);

            // Capture the title revision before exposing the session to the note editor.
            const titleInitialization = syncMeetingTitle(async () => {
              // Get meeting name
              const meetingName = await recordingService.getRecordingMeetingName();

              // Use a better fallback that matches the backend's naming pattern
              const effectiveTitle = meetingName || `Meeting ${new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}`;

              // Initialize meeting metadata in IndexedDB
              await indexedDBService.saveMeetingMetadata({
                meetingId,
                title: effectiveTitle,
                startTime: Date.now(),
                lastUpdated: Date.now(),
                transcriptCount: 0,
                savedToSQLite: false,
                folderPath: undefined // Will update shortly
              });

              return effectiveTitle;
            });
            applyCurrentMeetingId(meetingId);
            await titleInitialization;

            // Fetch folder path from backend and update metadata
            // This ensures folder path is persisted even if app crashes
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folderPath = await invoke<string>('get_meeting_folder_path');
              if (folderPath) {
                const metadata = await indexedDBService.getMeetingMetadata(meetingId);
                if (metadata) {
                  metadata.folderPath = folderPath;
                  await indexedDBService.saveMeetingMetadata(metadata);
                }
              }
            } catch (error) {
              // Non-fatal - will be set on stop if recording completes normally
            }
          } catch (error) {
            console.error('Failed to initialize meeting in IndexedDB:', error);
          }
        });

        // Listen for recording-stopped event
        unlistenRecordingStopped = await recordingService.onRecordingStopped(async (payload) => {
          try {
            const meetingId = currentMeetingIdRef.current;
            if (meetingId) {
              // Update folder path in IndexedDB
              const metadata = await indexedDBService.getMeetingMetadata(meetingId);

              if (metadata && payload.folder_path) {
                metadata.folderPath = payload.folder_path;
                await indexedDBService.saveMeetingMetadata(metadata);
              }
            }
          } catch (error) {
            console.error('Failed to update meeting metadata on stop:', error);
          }
        });
      } catch (error) {
        console.error('Failed to setup recording listeners:', error);
      }
    };

    setupRecordingListeners();

    return () => {
      if (unlistenRecordingStarted) {
        unlistenRecordingStarted();
        console.log('🧹 Recording started listener cleaned up');
      }
      if (unlistenRecordingStopped) {
        unlistenRecordingStopped();
        console.log('🧹 Recording stopped listener cleaned up');
      }
    };
    // `currentMeetingId` is intentionally absent: these listeners must survive the meeting
    // id changing mid-session. `beginSession`/`syncMeetingTitle` are stable callbacks.
  }, [applyCurrentMeetingId, beginSession, syncMeetingTitle]);

  // Main transcript buffering logic with sequence_id ordering
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let transcriptCounter = 0;
    let transcriptBuffer = new Map<number, Transcript>();
    let lastProcessedSequence = 0;
    let processingTimer: NodeJS.Timeout | undefined;

    const processBufferedTranscripts = (forceFlush = false) => {
      const sortedTranscripts: Transcript[] = [];

      // Process all available sequential transcripts
      let nextSequence = lastProcessedSequence + 1;
      while (transcriptBuffer.has(nextSequence)) {
        const bufferedTranscript = transcriptBuffer.get(nextSequence)!;
        sortedTranscripts.push(bufferedTranscript);
        transcriptBuffer.delete(nextSequence);
        lastProcessedSequence = nextSequence;
        nextSequence++;
      }

      // Add any buffered transcripts that might be out of order
      const now = Date.now();
      const staleThreshold = 100;  // 100ms safety net only (serial workers = sequential order)
      const recentThreshold = 0;    // Show immediately - no delay needed with serial processing
      const staleTranscripts: Transcript[] = [];
      const recentTranscripts: Transcript[] = [];
      const forceFlushTranscripts: Transcript[] = [];

      for (const [sequenceId, transcript] of transcriptBuffer.entries()) {
        if (forceFlush) {
          // Force flush mode: process ALL remaining transcripts regardless of timing
          forceFlushTranscripts.push(transcript);
          transcriptBuffer.delete(sequenceId);
          console.log(`Force flush: processing transcript with sequence_id ${sequenceId}`);
        } else {
          const transcriptAge = now - parseInt(transcript.id.split('-')[0]);
          if (transcriptAge > staleThreshold) {
            // Process stale transcripts (>100ms old - safety net)
            staleTranscripts.push(transcript);
            transcriptBuffer.delete(sequenceId);
          } else if (transcriptAge >= recentThreshold) {
            // Process immediately (0ms threshold with serial workers)
            recentTranscripts.push(transcript);
            transcriptBuffer.delete(sequenceId);
            console.log(`Processing transcript with sequence_id ${sequenceId}, age: ${transcriptAge}ms`);
          }
        }
      }

      // Sort both stale and recent transcripts by chunk_start_time, then by sequence_id
      const sortTranscripts = (transcripts: Transcript[]) => {
        return transcripts.sort((a, b) => {
          const chunkTimeDiff = (a.chunk_start_time || 0) - (b.chunk_start_time || 0);
          if (chunkTimeDiff !== 0) return chunkTimeDiff;
          return (a.sequence_id || 0) - (b.sequence_id || 0);
        });
      };

      const sortedStaleTranscripts = sortTranscripts(staleTranscripts);
      const sortedRecentTranscripts = sortTranscripts(recentTranscripts);
      const sortedForceFlushTranscripts = sortTranscripts(forceFlushTranscripts);

      const allNewTranscripts = [...sortedTranscripts, ...sortedRecentTranscripts, ...sortedStaleTranscripts, ...sortedForceFlushTranscripts];

      if (allNewTranscripts.length > 0) {
        setTranscripts(prev => {
          const existingSequenceKeys = new Set(
            prev.map(transcriptSequenceKey).filter((key): key is string => key !== null)
          );

          const uniqueNewTranscripts = allNewTranscripts.filter(transcript => {
            const key = transcriptSequenceKey(transcript);
            return key !== null && !existingSequenceKeys.has(key);
          });

          if (uniqueNewTranscripts.length === 0) {
            console.log('No unique transcripts to add - all were duplicates');
            return prev;
          }

          console.log(`Adding ${uniqueNewTranscripts.length} unique transcripts out of ${allNewTranscripts.length} received`);

          return [...prev, ...uniqueNewTranscripts].sort(compareTranscriptOrder);
        });

        // Log the processing summary
        const logMessage = forceFlush
          ? `Force flush processed ${allNewTranscripts.length} transcripts (${sortedTranscripts.length} sequential, ${forceFlushTranscripts.length} forced)`
          : `Processed ${allNewTranscripts.length} transcripts (${sortedTranscripts.length} sequential, ${recentTranscripts.length} recent, ${staleTranscripts.length} stale)`;
        console.log(logMessage);
      }
    };

    // Assign final flush function to ref for external access
    finalFlushRef.current = () => processBufferedTranscripts(true);

    // A new native session restarts sequence ids at 1, and this listener is no longer
    // remounted per meeting, so `recording-started` clears the buffer through this ref.
    resetTranscriptBufferRef.current = () => {
      if (processingTimer) {
        clearTimeout(processingTimer);
        processingTimer = undefined;
      }
      transcriptBuffer.clear();
      lastProcessedSequence = 0;
      transcriptCounter = 0;
    };

    const setupListener = async () => {
      try {
        console.log('🔥 Setting up MAIN transcript listener during component initialization...');
        unlistenFn = await transcriptService.onTranscriptUpdate((update) => {
          const now = Date.now();
          console.log('🎯 MAIN LISTENER: Received transcript update:', {
            sequence_id: update.sequence_id,
            text: update.text.substring(0, 50) + '...',
            timestamp: update.timestamp,
            is_partial: update.is_partial,
            received_at: new Date(now).toISOString(),
            buffer_size_before: transcriptBuffer.size
          });

          // Check for duplicate sequence_id before processing
          if (transcriptBuffer.has(update.sequence_id)) {
            console.log('🚫 MAIN LISTENER: Duplicate sequence_id, skipping buffer:', update.sequence_id);
            return;
          }

          // Create transcript for buffer with NEW timestamp fields
          const newTranscript: Transcript = {
            id: `${Date.now()}-${transcriptCounter++}`,
            text: update.text,
            timestamp: update.timestamp,
            sequence_id: update.sequence_id,
            sequence_scope: sequenceScopeRef.current,
            chunk_start_time: update.chunk_start_time,
            is_partial: update.is_partial,
            confidence: update.confidence,
            // NEW: Recording-relative timestamps for playback sync
            audio_start_time: update.audio_start_time,
            audio_end_time: update.audio_end_time,
            duration: update.duration,
          };

          // Add to buffer
          transcriptBuffer.set(update.sequence_id, newTranscript);
          console.log(`✅ MAIN LISTENER: Buffered transcript with sequence_id ${update.sequence_id}. Buffer size: ${transcriptBuffer.size}, Last processed: ${lastProcessedSequence}`);

          // Save to IndexedDB (non-blocking) against the meeting that is live right now
          const meetingId = currentMeetingIdRef.current;
          if (meetingId) {
            indexedDBService.saveTranscript(meetingId, update)
              .catch(err => console.warn('IndexedDB save failed:', err));
          }

          // Clear any existing timer and set a new one
          if (processingTimer) {
            clearTimeout(processingTimer);
          }

          // Process buffer with minimal delay for immediate UI updates (serial workers = sequential order)
          processingTimer = setTimeout(processBufferedTranscripts, 10);
        });
        console.log('✅ MAIN transcript listener setup complete');
      } catch (error) {
        console.error('❌ Failed to setup MAIN transcript listener:', error);
        alert('Failed to setup transcript listener. Check console for details.');
      }
    };

    setupListener();
    console.log('Started enhanced listener setup');

    return () => {
      console.log('🧹 CLEANUP: Cleaning up MAIN transcript listener...');
      if (processingTimer) {
        clearTimeout(processingTimer);
        console.log('🧹 CLEANUP: Cleared processing timer');
      }
      if (unlistenFn) {
        unlistenFn();
        console.log('🧹 CLEANUP: MAIN transcript listener cleaned up');
      }
    };
    // Registered once for the provider's lifetime. Depending on `currentMeetingId` here
    // unregistered the listener at the exact moment `recording-started` set it, dropping
    // every `transcript-update` emitted before `listen()` resolved again.
  }, []);

  // Sync transcript history and meeting name from backend on reload
  // This fixes the issue where reloading during active recording causes state desync
  useEffect(() => {
    const syncFromBackend = async () => {
      // If recording is active and we have no local transcripts, sync from backend
      if (recordingState.isRecording && transcripts.length === 0) {
        try {
          console.log('[Reload Sync] Recording active after reload, syncing transcript history...');

          // Fetch transcript history from backend
          const history = await transcriptService.getTranscriptHistory();
          console.log(`[Reload Sync] Retrieved ${history.length} transcript segments from backend`);

          // Convert backend format to frontend Transcript format
          const formattedTranscripts: Transcript[] = history.map((segment: any) => ({
            id: segment.id,
            text: segment.text,
            timestamp: segment.display_time, // Use display_time for UI
            sequence_id: segment.sequence_id,
            sequence_scope: sequenceScopeRef.current,
            chunk_start_time: segment.audio_start_time,
            is_partial: false, // History segments are always final
            confidence: segment.confidence,
            audio_start_time: segment.audio_start_time,
            audio_end_time: segment.audio_end_time,
            duration: segment.duration,
          }));

          setTranscripts(formattedTranscripts);
          console.log('[Reload Sync] ✅ Transcript history synced successfully');

          // The session holds edited titles; the recording manager retains its folder name.
          await syncMeetingTitle(async () => {
            const session = await recordingService.getMeetingSession();
            return session?.title || await recordingService.getRecordingMeetingName();
          });

          // `recording-started` is what normally hands out the live meeting id, and a
          // reload never sees it. Restoring it after the title lands lets the workspace
          // reattach its notes to the running session instead of editing a draft.
          const storedMeetingId = readLiveSessionId();
          if (storedMeetingId) applyCurrentMeetingId(prev => prev ?? storedMeetingId);
        } catch (error) {
          console.error('[Reload Sync] Failed to sync from backend:', error);
        }
      }
    };

    syncFromBackend();
  }, [recordingState.isRecording, syncMeetingTitle, applyCurrentMeetingId]); // Run when recording state changes

  // Manual transcript update handler (for RecordingControls component)
  const addTranscript = useCallback((update: TranscriptUpdate) => {
    console.log('🎯 addTranscript called with:', {
      sequence_id: update.sequence_id,
      text: update.text.substring(0, 50) + '...',
      timestamp: update.timestamp,
      is_partial: update.is_partial
    });

    const newTranscript: Transcript = {
      id: update.sequence_id ? update.sequence_id.toString() : Date.now().toString(),
      text: update.text,
      timestamp: update.timestamp,
      sequence_id: update.sequence_id || 0,
      sequence_scope: sequenceScopeRef.current,
      chunk_start_time: update.chunk_start_time,
      is_partial: update.is_partial,
      confidence: update.confidence,
      audio_start_time: update.audio_start_time,
      audio_end_time: update.audio_end_time,
      duration: update.duration,
    };

    setTranscripts(prev => {
      console.log('📊 Current transcripts count before update:', prev.length);

      // Check if this transcript already exists
      const exists = prev.some(
        t => t.text === update.text && t.timestamp === update.timestamp
      );
      if (exists) {
        console.log('🚫 Duplicate transcript detected, skipping:', update.text.substring(0, 30) + '...');
        return prev;
      }

      const sorted = [...prev, newTranscript].sort(compareTranscriptOrder);

      console.log('✅ Added new transcript. New count:', sorted.length);
      console.log('📝 Latest transcript:', {
        id: newTranscript.id,
        text: newTranscript.text.substring(0, 30) + '...',
        sequence_id: newTranscript.sequence_id
      });

      return sorted;
    });
  }, []);

  // Copy transcript to clipboard with recording-relative timestamps
  const copyTranscript = useCallback(() => {
    // Format timestamps as recording-relative [MM:SS] instead of wall-clock time
    const formatTime = (seconds: number | undefined): string => {
      if (seconds === undefined) return '[--:--]';
      const totalSecs = Math.floor(seconds);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    };

    const fullTranscript = transcripts
      .map(t => `${formatTime(t.audio_start_time)} ${t.text}`)
      .join('\n');
    navigator.clipboard.writeText(fullTranscript);

    toast.success("Transcript copied to clipboard");
  }, [transcripts]);

  // Force flush buffer (for final transcript processing)
  const flushBuffer = useCallback(() => {
    if (finalFlushRef.current) {
      console.log('🔄 Flushing transcript buffer...');
      finalFlushRef.current();
    }
  }, []);

  // Clear transcripts (used when starting new recording)
  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    // Don't clear currentMeetingId here - it will be set by recording-started event
  }, []);

  const beginResumeTranscriptSession = useCallback(() => {
    sequenceScopeRef.current += 1;
    sessionStorage.setItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY, String(sequenceScopeRef.current));
  }, []);

  const abortResumeTranscriptSession = useCallback(() => {
    sequenceScopeRef.current = Math.max(0, sequenceScopeRef.current - 1);
    if (sequenceScopeRef.current === 0) {
      sessionStorage.removeItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY);
    } else {
      sessionStorage.setItem(RESUME_SEQUENCE_SCOPE_STORAGE_KEY, String(sequenceScopeRef.current));
    }
  }, []);

  // Mark current meeting as saved in IndexedDB
  const markMeetingAsSaved = useCallback(async () => {
    // Try the live meeting id first, fallback to sessionStorage
    const meetingId = currentMeetingIdRef.current || readLiveSessionId();

    if (!meetingId) {
      console.error('[IndexedDB] ❌ Cannot mark meeting as saved: No meeting ID available!');
      console.error('[IndexedDB] currentMeetingId:', currentMeetingIdRef.current);
      console.error('[IndexedDB] sessionStorage:', readLiveSessionId());
      return;
    }

    try {
      await indexedDBService.markMeetingSaved(meetingId);

      // Clear both sources
      applyCurrentMeetingId(null);
      clearLiveSessionId();
    } catch (error) {
      console.error('[IndexedDB] ❌ Failed to mark meeting as saved:', error);
    }
  }, [applyCurrentMeetingId]);

  const value: TranscriptContextType = {
    transcripts,
    transcriptsRef,
    addTranscript,
    copyTranscript,
    flushBuffer,
    transcriptContainerRef,
    meetingTitle,
    setMeetingTitle,
    clearTranscripts,
    currentMeetingId,
    liveSessionId: currentMeetingId,
    markMeetingAsSaved,
    beginResumeTranscriptSession,
    abortResumeTranscriptSession,
  };

  return (
    <TranscriptContext.Provider value={value}>
      {children}
    </TranscriptContext.Provider>
  );
}

export function useTranscripts() {
  const context = useContext(TranscriptContext);
  if (context === undefined) {
    throw new Error('useTranscripts must be used within a TranscriptProvider');
  }
  return context;
}
