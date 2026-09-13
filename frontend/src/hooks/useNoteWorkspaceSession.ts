'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { appDataDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { isNamedDraftPlaceholder } from '@/lib/meetingTitle';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { useMeetingNotes } from '@/hooks/useMeetingNotes';
import { useMeetingTitleSave } from '@/hooks/useMeetingTitleSave';
import { clearQuickNoteDraft, loadQuickNoteDraftForFolder, saveQuickNoteDraft } from '@/lib/quickNoteDraft';
import { readLiveMeetingFolder } from '@/lib/liveMeetingFolder';
import { createRecordingPath, createSavedRecordingPath } from '@/lib/quickNoteRoute';
import {
  clearResumeIdentity,
  readAppendTargetMeetingId,
  resolveNotesOwnerId,
  writeResumeIdentity,
} from '@/lib/recordingSessionIdentity';
import {
  clearRecordingStopOptions,
  registerRecordingStopOptions,
  requestRecordingPostStop,
} from '@/lib/recordingStopOrchestrator';
import { blocksToPlainText, plainTextToBlocks } from '@/lib/meetingNotes';
import { recordingService } from '@/services/recordingService';
import {
  draftForWorkspaceRoute,
  isAttachableRecordingSession,
  planSessionSeed,
  resumeBaselineToSend,
  workspaceRouteKey,
  type NoteWorkspaceMode,
} from '@/lib/noteWorkspaceSession';

export function useNoteWorkspaceSession(
  mode: NoteWorkspaceMode,
  options?: {
    /** UI-only state that the original route reset also cleared. */
    onRouteReset?: () => void;
    /** Chat/summary teardown when starting a new live session on /recording. */
    onNewRecordingSession?: () => void;
  },
) {
  const onRouteResetRef = useRef(options?.onRouteReset);
  onRouteResetRef.current = options?.onRouteReset;
  const onNewRecordingSessionRef = useRef(options?.onNewRecordingSession);
  onNewRecordingSessionRef.current = options?.onNewRecordingSession;
  const isRecordingWorkspace = mode === 'recording';
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedFolderId = searchParams.get('folder');
  // Set once the session is saved, so reloading the workspace reopens the saved
  // note instead of starting another recording.
  const savedMeetingParam = isRecordingWorkspace ? searchParams.get('saved') : null;
  const [noteFolderId, setNoteFolderId] = useState<string | null>(null);
  const recordingState = useRecordingState();
  const {
    currentMeetingId,
    liveSessionId,
    meetingTitle,
    setMeetingTitle,
    transcriptsRef,
    clearTranscripts,
    beginResumeTranscriptSession,
    abortResumeTranscriptSession,
  } = useTranscripts();

  const [noteTitle, setNoteTitle] = useState('New note');
  const [draftContent, setDraftContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [isDraftLocked, setIsDraftLocked] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [savedMeetingId, setSavedMeetingId] = useState<string | null>(null);
  const resumeBaselineCountRef = useRef(0);
  const appendTargetMeetingIdRef = useRef<string | null>(null);
  const [savedTranscriptCount, setSavedTranscriptCount] = useState(0);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [hydratedSessionId, setHydratedSessionId] = useState<string | null>(null);
  const appendTargetMeetingId = appendTargetMeetingIdRef.current || readAppendTargetMeetingId();
  const notesOwnerId = resolveNotesOwnerId({
    liveSessionId: liveSessionId ?? currentMeetingId,
    persistedMeetingId: savedMeetingId,
    appendTargetMeetingId,
  });
  const {
    blocks,
    saveNotes,
    replaceNotes,
    flushPendingSave,
    isSaving,
    isReady,
    saveError,
    loadError,
    retryLoad,
  } = useMeetingNotes(notesOwnerId);

  const seededSessionIdsRef = useRef<Set<string>>(new Set());
  // One start request per workspace entry; a reload attaches instead of restarting.
  const sessionRequestedRef = useRef(false);
  const attachedToRunningSessionRef = useRef(false);
  const savedHydrationRef = useRef<string | null>(null);
  const titleSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleSave = useMeetingTitleSave(savedMeetingId);
  const handleTitleChange = (title: string) => {
    setNoteTitle(title);
    void titleSave.save(title).catch(error => {
      console.error('Failed to save meeting title:', error);
      toast.error('Could not save the meeting title. Please retry.');
    });
  };
  const preSessionDraftRef = useRef<{ title: string; content: string } | null>(null);

  const isLiveSessionVisible =
    recordingState.isRecording ||
    recordingState.status === RecordingStatus.STARTING ||
    recordingState.status === RecordingStatus.STOPPING ||
    recordingState.status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
    recordingState.status === RecordingStatus.SAVING;

  // The URL is the whole description of this workspace, so the reset only has to run
  // when the route itself changes - not when the page rewrites its own URL.
  const routeKey = workspaceRouteKey(mode, requestedFolderId, savedMeetingParam);
  const appliedRouteKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (appliedRouteKeyRef.current === routeKey) return;
    appliedRouteKeyRef.current = routeKey;

    const stored = loadQuickNoteDraftForFolder(requestedFolderId);
    const draft = draftForWorkspaceRoute({
      isRecordingWorkspace,
      stored,
      requestedFolderId,
    });
    setIsDraftLocked(!isRecordingWorkspace && Boolean(stored.saveId));
    setNoteFolderId(currentMeetingId ? readLiveMeetingFolder(currentMeetingId) : draft.folderId);
    sessionRequestedRef.current = false;
    attachedToRunningSessionRef.current = false;
    savedHydrationRef.current = savedMeetingParam;
    seededSessionIdsRef.current.clear();
    preSessionDraftRef.current = {
      title: draft.title,
      content: draft.content,
    };

    setSavedMeetingId(savedMeetingParam);
    setSavedTranscriptCount(0);
    setIsTranscriptOpen(false);
    setHydratedSessionId(null);
    setNoteTitle(currentMeetingId ? meetingTitle : draft.title);
    setDraftContent(draft.content);
    setUpdatedAt(draft.updatedAt);
    setHasLoadedDraft(true);
    onRouteResetRef.current?.();
  }, [routeKey]);

  // A session started from the tray, sidebar, or call banner owns the recording route.
  useEffect(() => {
    if (isRecordingWorkspace || !isLiveSessionVisible || !hasLoadedDraft) return;
    // Hand over what is written here; the recording workspace opens with it.
    if (!notesOwnerId) saveQuickNoteDraft(noteTitle, draftContent, noteFolderId);
    router.replace(createRecordingPath(noteFolderId));
  }, [notesOwnerId, draftContent, hasLoadedDraft, isLiveSessionVisible, isRecordingWorkspace, noteFolderId, noteTitle, router]);

  useEffect(() => {
    if (currentMeetingId) return;
    preSessionDraftRef.current = {
      title: noteTitle.trim() || 'New note',
      content: draftContent,
    };
  }, [currentMeetingId, draftContent, noteTitle]);

  useEffect(() => {
    if (!currentMeetingId) {
      setHydratedSessionId(null);
    }
  }, [currentMeetingId]);

  useEffect(() => {
    if (!hasLoadedDraft || isDraftLocked || currentMeetingId || isLiveSessionVisible || savedMeetingId) {
      return;
    }

    const saved = saveQuickNoteDraft(noteTitle, draftContent, noteFolderId);
    setUpdatedAt(saved.updatedAt);
  }, [noteTitle, draftContent, noteFolderId, hasLoadedDraft, isDraftLocked, currentMeetingId, isLiveSessionVisible, savedMeetingId]);

  // Entering /recording is the request to capture. Reloading it is not: the native
  // session is the source of truth, so a running one is attached to, never restarted.
  useEffect(() => {
    if (!isRecordingWorkspace) return;
    if (
      !hasLoadedDraft ||
      sessionRequestedRef.current ||
      savedMeetingParam ||
      currentMeetingId ||
      savedMeetingId ||
      isStoppingSession
    ) {
      return;
    }

    if (isLiveSessionVisible) {
      attachedToRunningSessionRef.current = true;
      sessionRequestedRef.current = true;
      return;
    }

    sessionRequestedRef.current = true;
    let cancelled = false;

    const startOrAttach = async () => {
      const activeSession = await recordingService.getMeetingSession().catch(() => null);
      if (cancelled) return;

      if (isAttachableRecordingSession(activeSession, recordingState.isRecording)) {
        attachedToRunningSessionRef.current = true;
        return;
      }

      try {
        await invoke('request_recording_start', { source: 'recording_route' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Recording already in progress')) {
          attachedToRunningSessionRef.current = true;
          return;
        }
        sessionRequestedRef.current = false;
        console.error('Failed to start recording for the recording workspace:', error);
        toast.error('Failed to start recording');
      }
    };

    void startOrAttach();

    return () => {
      cancelled = true;
    };
  }, [
    currentMeetingId,
    hasLoadedDraft,
    isLiveSessionVisible,
    isRecordingWorkspace,
    isStoppingSession,
    recordingState.isRecording,
    savedMeetingId,
    savedMeetingParam,
  ]);

  useEffect(() => {
    if (!currentMeetingId || !hasLoadedDraft || !isReady) return;
    if (seededSessionIdsRef.current.has(currentMeetingId)) return;

    const resumeAppend = Boolean(appendTargetMeetingIdRef.current || readAppendTargetMeetingId());
    const plan = planSessionSeed({
      resumeAppend,
      attachedToRunning: attachedToRunningSessionRef.current,
      meetingTitle: meetingTitle ?? '',
      noteTitle,
      draftContent,
      fallbackSeed: preSessionDraftRef.current,
      blocksEmpty: blocks.length === 0,
    });

    if (plan.kind === 'resume-append') {
      // A new live capture id is expected; notes stay on notesOwnerId. Do not
      // reseed or rebind folder from empty live storage.
      seededSessionIdsRef.current.add(currentMeetingId);
      setHydratedSessionId(currentMeetingId);
      return;
    }

    seededSessionIdsRef.current.add(currentMeetingId);
    setNoteFolderId(readLiveMeetingFolder(currentMeetingId));

    // Attaching to a session that is already running: adopt its title and notes
    // rather than seeding it from a draft this workspace never wrote.
    if (plan.kind === 'attach-running') {
      setNoteTitle(plan.title);
      setHydratedSessionId(currentMeetingId);
      preSessionDraftRef.current = null;
      return;
    }

    setNoteTitle(plan.title);
    // Named placeholders must not overwrite a missing or generated session title.
    // Wait and adopt meetingTitle once it becomes a generated timestamp or custom name.
    if (plan.syncTitleToSession) {
      setMeetingTitle(plan.title);
      void recordingService.updateMeetingSessionTitle(plan.title).catch(error => {
        console.error('Failed to sync quick note title to meeting session:', error);
      });
    }

    if (plan.content) {
      replaceNotes(plainTextToBlocks(plan.content), { immediate: true });
    }

    setHydratedSessionId(currentMeetingId);
    clearQuickNoteDraft();
    preSessionDraftRef.current = null;
  }, [
    blocks.length,
    currentMeetingId,
    draftContent,
    hasLoadedDraft,
    isReady,
    meetingTitle,
    noteTitle,
    replaceNotes,
    setMeetingTitle,
  ]);

  useEffect(() => {
    if (!currentMeetingId) return;
    // Only a hydrated workspace owns the session title; pushing before that would
    // overwrite a live session's name with this page's placeholder.
    if (hydratedSessionId !== currentMeetingId) return;

    if (titleSyncTimerRef.current) {
      clearTimeout(titleSyncTimerRef.current);
    }

    const normalizedTitle = noteTitle.trim() || 'New note';
    // Never push named placeholders to the live session — they race the generated
    // timestamp and wipe custom titles. Adoption + explicit clear/save own those writes.
    if (isNamedDraftPlaceholder(normalizedTitle)) {
      return;
    }
    setMeetingTitle(normalizedTitle);
    titleSyncTimerRef.current = setTimeout(() => {
      void recordingService.updateMeetingSessionTitle(normalizedTitle).catch(error => {
        console.error('Failed to update meeting session title:', error);
      });
    }, 250);

    return () => {
      if (titleSyncTimerRef.current) {
        clearTimeout(titleSyncTimerRef.current);
        titleSyncTimerRef.current = null;
      }
    };
  }, [currentMeetingId, hydratedSessionId, noteTitle, setMeetingTitle]);

  useEffect(() => {
    if (!currentMeetingId && !savedMeetingId && !isLiveSessionVisible) return;
    const sessionTitle = meetingTitle?.trim() || '';
    if (!sessionTitle || isNamedDraftPlaceholder(sessionTitle)) return;
    if (!isNamedDraftPlaceholder(noteTitle)) return;
    setNoteTitle(sessionTitle);
  }, [currentMeetingId, isLiveSessionVisible, meetingTitle, noteTitle, savedMeetingId]);

  const noteText = useMemo(() => {
    if (notesOwnerId && isReady) {
      return blocksToPlainText(blocks);
    }
    return draftContent;
  }, [notesOwnerId, blocks, draftContent, isReady]);

  const isPostRecording = !recordingState.isRecording && !isStoppingSession && Boolean(savedMeetingId);
  const shouldWaitForSessionHydration =
    Boolean(currentMeetingId) &&
    isReady &&
    hydratedSessionId !== currentMeetingId &&
    draftContent.trim().length > 0 &&
    blocks.length === 0;
  const shouldRenderEditor = Boolean(notesOwnerId) && isReady && !shouldWaitForSessionHydration;
  const notesSourceReady = (!notesOwnerId || isReady) && !shouldWaitForSessionHydration;
  const shouldRenderPendingTextarea = !shouldRenderEditor && !isPostRecording;

  // The URL rewrite is this page's own, so it must not replay the route reset.
  const replaceWorkspaceUrl = (path: string, folderId: string | null, savedId: string | null) => {
    appliedRouteKeyRef.current = workspaceRouteKey(mode, folderId, savedId);
    router.replace(path);
  };

  const showSavedSessionInUrl = (meetingId: string) => {
    replaceWorkspaceUrl(createSavedRecordingPath(meetingId, noteFolderId), noteFolderId, meetingId);
  };

  const handleStopSession = async () => {
    if (!recordingState.isRecording || isStoppingSession) return;

    setIsStoppingSession(true);
    try {
      await flushPendingSave(false);

      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      const stopResult = await recordingService.stopRecording(savePath);
      // Only the tray path emits `recording-stop-result`, so a UI-initiated stop has
      // to surface its own partial result or it ends silently. This is the only
      // notifier for this path - do not also emit the event from Rust's stop_recording
      // or both listeners would fire for one stop.
      if (stopResult.status !== 'complete') {
        toast.error('Recording stopped with incomplete transcript', {
          description: stopResult.message,
        });
      }
      const appendToMeetingId = appendTargetMeetingIdRef.current || readAppendTargetMeetingId() || undefined;
      const meetingId = await requestRecordingPostStop(stopResult.status === 'complete', {
        autoNavigate: false,
        showToast: false,
        appendToMeetingId,
        resumeBaselineCount: appendToMeetingId ? resumeBaselineToSend(resumeBaselineCountRef.current) : undefined,
        onSaved: async (nextMeetingId) => {
          appendTargetMeetingIdRef.current = null;
          resumeBaselineCountRef.current = 0;
          setSavedMeetingId(nextMeetingId);
          setSavedTranscriptCount(transcriptsRef.current.length);
          setIsTranscriptOpen(false);
          clearQuickNoteDraft();
          preSessionDraftRef.current = null;
          showSavedSessionInUrl(nextMeetingId);
        },
      });
      if (meetingId) {
        setSavedMeetingId(meetingId);
        showSavedSessionInUrl(meetingId);
      }
    } catch (error) {
      console.error('Failed to stop quick note recording:', error);
      toast.error('Failed to stop recording');
      await requestRecordingPostStop(false);
    } finally {
      setIsStoppingSession(false);
    }
  };

  useEffect(() => {
    if (!isRecordingWorkspace || !isLiveSessionVisible) {
      clearRecordingStopOptions();
      return;
    }
    const appendToMeetingId = appendTargetMeetingIdRef.current || readAppendTargetMeetingId() || undefined;
    registerRecordingStopOptions({
      autoNavigate: false,
      showToast: false,
      appendToMeetingId,
      resumeBaselineCount: appendToMeetingId ? resumeBaselineToSend(resumeBaselineCountRef.current) : undefined,
      onSaved: async (nextMeetingId) => {
        appendTargetMeetingIdRef.current = null;
        resumeBaselineCountRef.current = 0;
        setSavedMeetingId(nextMeetingId);
        setSavedTranscriptCount(transcriptsRef.current.length);
        setIsTranscriptOpen(false);
        clearQuickNoteDraft();
        preSessionDraftRef.current = null;
        showSavedSessionInUrl(nextMeetingId);
      },
    });

    // Navigating away leaves these options registered, so a later tray stop would
    // save into this workspace's stale append target / callbacks.
    return () => clearRecordingStopOptions();
  }, [isLiveSessionVisible, isRecordingWorkspace, noteFolderId, savedMeetingId]);

  const handleStartRecording = async () => {
    try {
      await flushPendingSave(false);
      await titleSave.flush();
    } catch {
      return;
    }
    // A new recording started from a saved note is a new note, not a copy of that
    // one: seeding it from the saved title/body would clone it into a second
    // meeting (and into the shared quick-note draft).
    const startsFromSavedNote = isRecordingWorkspace && Boolean(savedMeetingId);
    const currentText = startsFromSavedNote ? '' : noteText;
    const normalizedTitle = startsFromSavedNote ? 'New note' : (noteTitle.trim() || 'New note');
    if (startsFromSavedNote) {
      clearQuickNoteDraft();
    } else {
      // The live session opens with whatever was already written here.
      saveQuickNoteDraft(normalizedTitle, currentText, noteFolderId);
    }

    if (!isRecordingWorkspace) {
      // The draft surface never captures audio; the recording route owns the session.
      router.push(createRecordingPath(noteFolderId));
      return;
    }

    // Switching identity resets the view without erasing the previous meeting.
    appendTargetMeetingIdRef.current = null;
    resumeBaselineCountRef.current = 0;
    clearResumeIdentity();
    // Starting from a saved note leaves that note's hydrated segments in the buffer
    // until `recording-started` lands. Copy, the transcript sheet, and Ask read the
    // buffer, so clear it now rather than showing the previous note's transcript
    // during startup (or forever, if the start request fails).
    clearTranscripts();
    onNewRecordingSessionRef.current?.();
    // The seed plan reads live `noteTitle` ahead of the fallback seed, so the saved
    // note's title has to be cleared here too, not just in the fallback.
    if (startsFromSavedNote) setNoteTitle(normalizedTitle);
    setDraftContent(currentText);
    preSessionDraftRef.current = {
      title: normalizedTitle,
      content: currentText,
    };
    setSavedMeetingId(null);
    setSavedTranscriptCount(0);
    setIsTranscriptOpen(true);
    replaceWorkspaceUrl(createRecordingPath(noteFolderId), noteFolderId, null);
    sessionRequestedRef.current = true;
    attachedToRunningSessionRef.current = false;

    try {
      await invoke('request_recording_start', { source: 'recording_new_session' });
    } catch (error) {
      sessionRequestedRef.current = false;
      console.error('Failed to start new recording:', error);
      toast.error('Failed to start new recording');
    }
  };

  const handleResumeRecording = async () => {
    if (!savedMeetingId || recordingState.isRecording || isStoppingSession) return;
    try {
      await flushPendingSave(false);
      await titleSave.flush();
    } catch {
      return;
    }

    appendTargetMeetingIdRef.current = savedMeetingId;
    resumeBaselineCountRef.current = transcriptsRef.current.length;
    writeResumeIdentity(savedMeetingId, resumeBaselineCountRef.current);
    beginResumeTranscriptSession();

    // Stay on the saved note identity with the transcript closed, matching Granola.
    sessionRequestedRef.current = true;
    attachedToRunningSessionRef.current = false;

    try {
      await invoke('request_recording_start', { source: 'recording_resume' });
    } catch (error) {
      sessionRequestedRef.current = false;
      appendTargetMeetingIdRef.current = null;
      abortResumeTranscriptSession();
      clearResumeIdentity();
      console.error('Failed to resume recording:', error);
      toast.error('Failed to resume recording');
    }
  };

  const consumeSavedHydration = useCallback((meetingId: string) => {
    if (savedHydrationRef.current !== meetingId) return false;
    savedHydrationRef.current = null;
    return true;
  }, []);

  return {
    isRecordingWorkspace,
    requestedFolderId,
    noteFolderId,
    setNoteFolderId,
    noteTitle,
    setNoteTitle,
    handleTitleChange,
    draftContent,
    setDraftContent,
    updatedAt,
    setUpdatedAt,
    hasLoadedDraft,
    isDraftLocked,
    setIsDraftLocked,
    isStoppingSession,
    savedMeetingId,
    setSavedMeetingId,
    savedTranscriptCount,
    setSavedTranscriptCount,
    isTranscriptOpen,
    setIsTranscriptOpen,
    hydratedSessionId,
    notesOwnerId,
    blocks,
    saveNotes,
    replaceNotes,
    flushPendingSave,
    isSaving,
    isReady,
    saveError,
    loadError,
    retryLoad,
    titleSave,
    isLiveSessionVisible,
    noteText,
    isPostRecording,
    shouldWaitForSessionHydration,
    shouldRenderEditor,
    notesSourceReady,
    shouldRenderPendingTextarea,
    handleStopSession,
    handleStartRecording,
    handleResumeRecording,
    consumeSavedHydration,
    recordingState,
    currentMeetingId,
    meetingTitle,
    setMeetingTitle,
  };
}
