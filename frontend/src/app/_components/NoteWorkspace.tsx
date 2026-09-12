'use client';

import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { appDataDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Copy,
  Folder,
  Loader2,
  Mic,
  MoreHorizontal,
  Square,
} from 'lucide-react';
import type { Block } from '@blocknote/core';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { MeetingAssistantDock } from '@/components/MeetingDetails/MeetingAssistantDock';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useMeetingNotes } from '@/hooks/useMeetingNotes';
import { useMeetingTitleSave } from '@/hooks/useMeetingTitleSave';
import { useAutoSizeTitle } from '@/hooks/useAutoSizeTitle';
import { NoteSaveStatus } from '@/components/NoteSaveStatus';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { usePersistentChat } from '@/hooks/useSavedMeetingChat';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { clearQuickNoteDraft, loadQuickNoteDraftForFolder, saveQuickNoteDraft } from '@/lib/quickNoteDraft';
import { readLiveMeetingFolder } from '@/lib/liveMeetingFolder';
import { createRecordingPath, createSavedRecordingPath } from '@/lib/quickNoteRoute';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { saveDraftNote } from '@/lib/saveDraftNote';
import { blocksToPlainText, plainTextToBlocks } from '@/lib/meetingNotes';
import { recordingService } from '@/services/recordingService';
import { storageService } from '@/services/storageService';
import { Summary } from '@/types';
import { SummaryGeneratorButtonGroup } from '@/components/MeetingDetails/SummaryGeneratorButtonGroup';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { buildMeetingAnswerContext } from '@/lib/meetingAnswerContext';
import { EnhanceNotesCta } from '@/components/EnhanceNotesCta';

const Editor = dynamic(() => import('@/components/BlockNoteEditor/Editor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-stone-400">
      Loading live note...
    </div>
  ),
});

type Recipe = {
  label: string;
  prompt: string;
  scope: 'last5min' | 'full';
};

const RECIPES: Recipe[] = [
  {
    label: 'What did I miss?',
    prompt: 'Summarize what was discussed in the last 5 minutes in 2-3 bullet points.',
    scope: 'last5min',
  },
  {
    label: 'Suggest topics',
    prompt: 'Suggest 2-3 high-value topics or questions I could raise next.',
    scope: 'full',
  },
  {
    label: 'Action items',
    prompt: 'List the concrete action items and who owns them from the transcript so far.',
    scope: 'full',
  },
];

function formatTranscriptTime(seconds?: number) {
  if (seconds === undefined || seconds === null) return '--:--';
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function isGeneratedMeetingTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (trimmed === 'New note') return true;
  return /^Meeting \d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(trimmed);
}

function isPlaceholderMeetingTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (trimmed === '+ New Call') return true;
  return isGeneratedMeetingTitle(trimmed);
}

function formatSavedAt(timestamp: number | null) {
  if (!timestamp) return 'Stored locally on this Mac';
  return `Updated ${new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function parseSummaryData(summary: any): Summary | null {
  if (!summary) return null;

  if (summary.status === 'idle' || (!summary.data && summary.status === 'error')) {
    return null;
  }

  let parsedData = summary.data || {};
  if (typeof parsedData === 'string') {
    try {
      parsedData = JSON.parse(parsedData);
    } catch {
      parsedData = {};
    }
  }

  if (parsedData.summary_json || parsedData.markdown) {
    return parsedData as Summary;
  }

  const { MeetingName, _section_order, ...restSummaryData } = parsedData;
  const formattedSummary: Summary = {};
  const sectionKeys = _section_order || Object.keys(restSummaryData);

  for (const key of sectionKeys) {
    const section = restSummaryData[key];
    if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
      const typedSection = section as { title?: string; blocks?: any[] };
      formattedSummary[key] = {
        title: typedSection.title || key,
        blocks: Array.isArray(typedSection.blocks)
          ? typedSection.blocks.map((block: any) => ({
              ...block,
              color: 'default',
              content: block?.content?.trim() || '',
            }))
          : [],
      };
    }
  }

  return Object.keys(formattedSummary).length > 0 ? formattedSummary : null;
}

export type NoteWorkspaceMode = 'draft' | 'recording';

/**
 * The note workspace, rendered by two routes:
 *
 * - `mode="draft"` (`/quick-note`) never captures audio.
 * - `mode="recording"` (`/recording`) owns the live session: it starts one when the
 *   route is entered fresh, and attaches to a running one after a reload.
 */
export function NoteWorkspace({ mode }: { mode: NoteWorkspaceMode }) {
  const isRecordingWorkspace = mode === 'recording';
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedFolderId = searchParams.get('folder');
  // Set once the session is saved, so reloading the workspace reopens the saved
  // note instead of starting another recording.
  const savedMeetingParam = isRecordingWorkspace ? searchParams.get('saved') : null;
  const { noteFolders, refetchMeetings } = useSidebar();
  const [noteFolderId, setNoteFolderId] = useState<string | null>(null);
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);
  const [isDraftLocked, setIsDraftLocked] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState('');
  const librarySaveInFlight = useRef(false);
  const noteFolder = noteFolders.data?.find(folder => folder.id === noteFolderId);
  const recordingState = useRecordingState();
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptTriggerRef = useRef<HTMLButtonElement | null>(null);
  const summaryRef = useRef<BlockNoteSummaryViewRef>(null);
  const [isSummaryDirty, setIsSummaryDirty] = useState(false);
  const [isSummarySaving, setIsSummarySaving] = useState(false);
  const [summarySaveError, setSummarySaveError] = useState(false);
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const {
    currentMeetingId,
    meetingTitle,
    setMeetingTitle,
    transcripts,
    transcriptsRef,
  } = useTranscripts();
  const { modelConfig, setModelConfig } = useConfig();
  const templates = useTemplates();

  const [noteTitle, setNoteTitle] = useState('New note');
  const [draftContent, setDraftContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [savedMeetingId, setSavedMeetingId] = useState<string | null>(null);
  const resumeBaselineCountRef = useRef(0);
  const appendTargetMeetingIdRef = useRef<string | null>(null);
  const [chatRecordingId, setChatRecordingId] = useState<string | null>(null);
  const [savedTranscriptCount, setSavedTranscriptCount] = useState(0);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isAiComposerOpen, setIsAiComposerOpen] = useState(false);
  const [activeSavedView, setActiveSavedView] = useState<'notes' | 'summary'>('notes');
  const [hydratedSessionId, setHydratedSessionId] = useState<string | null>(null);
  const [savedMeetingCreatedAt, setSavedMeetingCreatedAt] = useState<string>(new Date().toISOString());
  const [aiSummary, setAiSummary] = useState<Summary | null>(null);
  const [savedSummaryState, setSavedSummaryState] = useState<{ meetingId: string; status: string } | null>(null);
  const activeNotesMeetingId = currentMeetingId ?? savedMeetingId;
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
  } = useMeetingNotes(activeNotesMeetingId);
  // Keep the recording identity across Stop; native persistence redirects it to
  // the saved meeting atomically, including answers that finish after Stop.
  const conversationRecordingId = currentMeetingId || chatRecordingId;
  const { messages, isLoading: isChatLoading, send, clearMessages, stop, ready: chatReady, historyError, retryHistory } = usePersistentChat(
    conversationRecordingId || savedMeetingId || '', conversationRecordingId ? 'recording' : 'meeting',
  );
  useEffect(() => { if (currentMeetingId) setChatRecordingId(currentMeetingId); }, [currentMeetingId]);

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
  const noopSetRecording = () => {};
  const noopSetDisabled = () => {};
  const { handleRecordingStop } = useRecordingStop(noopSetRecording, noopSetDisabled);
  const summaryMeeting = {
    id: savedMeetingId || activeNotesMeetingId || '',
    title: noteTitle,
    created_at: savedMeetingCreatedAt,
    transcripts: [],
  };

  const isLiveSessionVisible =
    recordingState.isRecording ||
    recordingState.status === RecordingStatus.STARTING ||
    recordingState.status === RecordingStatus.STOPPING ||
    recordingState.status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
    recordingState.status === RecordingStatus.SAVING;

  // The URL is the whole description of this workspace, so the reset only has to run
  // when the route itself changes - not when the page rewrites its own URL.
  const routeKey = `${mode}|${requestedFolderId ?? ''}|${savedMeetingParam ?? ''}`;
  const appliedRouteKeyRef = useRef<string | null>(null);
  const routeKeyFor = (folderId: string | null, savedId: string | null) =>
    `${mode}|${folderId ?? ''}|${savedId ?? ''}`;

  useLayoutEffect(() => {
    if (appliedRouteKeyRef.current === routeKey) return;
    appliedRouteKeyRef.current = routeKey;

    const stored = loadQuickNoteDraftForFolder(requestedFolderId);
    // A draft waiting on its own save belongs to the draft surface; never replay it
    // into a recording, where it would be saved a second time.
    const draft = isRecordingWorkspace && stored.saveId
      ? { ...stored, title: 'New note', content: '', updatedAt: null, folderId: requestedFolderId }
      : stored;
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
    setIsAiComposerOpen(false);
    setActiveSavedView('notes');
    setHydratedSessionId(null);
    setAiSummary(null);
    setNoteTitle(currentMeetingId ? meetingTitle : draft.title);
    setDraftContent(draft.content);
    setUpdatedAt(draft.updatedAt);
    setHasLoadedDraft(true);
  }, [routeKey]);

  // A session started from the tray, sidebar, or call banner owns the recording route.
  useEffect(() => {
    if (isRecordingWorkspace || !isLiveSessionVisible || !hasLoadedDraft) return;
    // Hand over what is written here; the recording workspace opens with it.
    if (!activeNotesMeetingId) saveQuickNoteDraft(noteTitle, draftContent, noteFolderId);
    router.replace(createRecordingPath(noteFolderId));
  }, [activeNotesMeetingId, draftContent, hasLoadedDraft, isLiveSessionVisible, isRecordingWorkspace, noteFolderId, noteTitle, router]);

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

      if ((activeSession && ['recording', 'paused', 'stopping', 'processing_transcripts', 'saving'].includes(activeSession.status)) || recordingState.isRecording) {
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

    seededSessionIdsRef.current.add(currentMeetingId);
    setNoteFolderId(readLiveMeetingFolder(currentMeetingId));

    // Attaching to a session that is already running: adopt its title and notes
    // rather than seeding it from a draft this workspace never wrote.
    if (attachedToRunningSessionRef.current) {
      setNoteTitle(meetingTitle?.trim() || 'New note');
      setHydratedSessionId(currentMeetingId);
      preSessionDraftRef.current = null;
      return;
    }

    const fallbackSeed = preSessionDraftRef.current;
    const liveDraftTitle = noteTitle.trim();
    const liveDraftContent = draftContent;
    const seedTitle = liveDraftTitle || fallbackSeed?.title?.trim() || '';
    const seedContent = liveDraftContent.trim().length > 0
      ? liveDraftContent
      : (fallbackSeed?.content ?? '');
    const sessionTitle = meetingTitle?.trim() || '';
    const nextTitle = seedTitle || (isPlaceholderMeetingTitle(sessionTitle) ? 'New note' : sessionTitle);

    setNoteTitle(nextTitle);
    setMeetingTitle(nextTitle);
    void recordingService.updateMeetingSessionTitle(nextTitle).catch(error => {
      console.error('Failed to sync quick note title to meeting session:', error);
    });

    if (blocks.length === 0 && seedContent.trim()) {
      const seededBlocks = plainTextToBlocks(seedContent);
      replaceNotes(seededBlocks, { immediate: true });
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

  const noteText = useMemo(() => {
    if (activeNotesMeetingId && isReady) {
      return blocksToPlainText(blocks);
    }
    return draftContent;
  }, [activeNotesMeetingId, blocks, draftContent, isReady]);

  const isPostRecording = !recordingState.isRecording && !isStoppingSession && Boolean(savedMeetingId);
  const shouldWaitForSessionHydration =
    Boolean(currentMeetingId) &&
    isReady &&
    hydratedSessionId !== currentMeetingId &&
    draftContent.trim().length > 0 &&
    blocks.length === 0;
  const shouldRenderEditor = Boolean(activeNotesMeetingId) && isReady && !shouldWaitForSessionHydration;
  const notesSourceReady = (!activeNotesMeetingId || isReady) && !shouldWaitForSessionHydration;
  const shouldRenderPendingTextarea = !shouldRenderEditor && !isPostRecording;
  const isNoteEmpty = noteText.trim().length === 0;
  const showSavedSummary = isPostRecording && activeSavedView === 'summary' && Boolean(aiSummary);


  const handleRegisterModalOpen = (openFn: () => void) => {
    openModelSettingsRef.current = openFn;
  };

  const handleOpenModelSettings = () => {
    openModelSettingsRef.current?.();
  };

  const handleSaveModelConfig = async (config?: typeof modelConfig) => {
    if (!config) return;
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);
      toast.success('Model settings saved successfully');
    } catch (error) {
      console.error('Failed to save model config:', error);
      toast.error('Failed to save model settings');
    }
  };

  const handleSaveSummary = async (summary: Summary | { markdown?: string; summary_json?: any[] }) => {
    try {
      const formattedSummary =
        'markdown' in summary || 'summary_json' in summary
          ? summary
          : {
              MeetingName: noteTitle,
              MeetingNotes: {
                sections: Object.entries(summary).map(([, section]) => ({
                  title: section.title,
                  blocks: section.blocks,
                })),
              },
            };

      await invoke('api_save_meeting_summary', {
        meetingId: savedMeetingId,
        summary: formattedSummary,
      });
      setSummarySaveError(false);
    } catch (error) {
      setSummarySaveError(true);
      console.error('Failed to save quick note summary:', error);
      toast.error('Failed to save summary');
      throw error;
    }
  };

  const summaryGeneration = useSummaryGeneration({
    meeting: summaryMeeting,
    transcripts: [],
    notesText: noteText,
    notesReady: notesSourceReady,
    initialSummaryStatus: savedSummaryState?.meetingId === summaryMeeting.id ? savedSummaryState.status : undefined,
    modelConfig,
    isModelConfigLoading: false,
    selectedTemplate: templates.selectedTemplate,
    updateMeetingTitle: (title: string) => {
      setNoteTitle(title);
    },
    setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
    beforeGenerate: async () => { await summaryRef.current?.saveSummary(); },
  });

  const isSummaryGenerating =
    summaryGeneration.summaryStatus === 'processing' ||
    summaryGeneration.summaryStatus === 'summarizing' ||
    summaryGeneration.summaryStatus === 'regenerating';
  const showEnhanceNotesCta = isPostRecording && !aiSummary && !isSummaryGenerating;

  useAutoSizeTitle(titleRef, noteTitle, isPostRecording);

  useEffect(() => {
    setSavedSummaryState(null);
    if (!savedMeetingId) {
      setAiSummary(null);
      return;
    }

    let cancelled = false;

    const loadSavedMeetingContext = async () => {
      try {
        const [meeting, summary] = await Promise.all([
          storageService.getMeeting(savedMeetingId),
          invoke('api_get_summary', { meetingId: savedMeetingId }),
        ]);

        if (cancelled) return;

        setSavedSummaryState({ meetingId: savedMeetingId, status: (summary as { status?: string } | null)?.status || 'idle' });

        if (meeting?.created_at) {
          setSavedMeetingCreatedAt(meeting.created_at);
        }

        // Reopened from the URL after a reload: the saved meeting, not the draft,
        // is what this workspace is showing.
        if (savedHydrationRef.current === savedMeetingId) {
          savedHydrationRef.current = null;
          if (meeting?.title) setNoteTitle(meeting.title);
          setSavedTranscriptCount(Array.isArray(meeting?.transcripts) ? meeting.transcripts.length : 0);
        }

        const parsedSummary = parseSummaryData(summary);
        setAiSummary(parsedSummary);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load saved quick note context:', error);
        setAiSummary(null);
      }
    };

    void loadSavedMeetingContext();

    return () => {
      cancelled = true;
    };
  }, [savedMeetingId]);

  useEffect(() => {
    if (!isPostRecording) {
      setIsAiComposerOpen(false);
      return;
    }

    setActiveSavedView(aiSummary ? 'summary' : 'notes');
  }, [aiSummary, isPostRecording]);

  const handleCopyNote = async () => {
    if (!noteText.trim()) {
      toast.error('Live note is empty');
      return;
    }

    try {
      await navigator.clipboard.writeText(`${noteTitle.trim() || 'New note'}\n\n${noteText}`);
      toast.success('Live note copied');
    } catch (error) {
      toast.error('Failed to copy live note');
    }
  };

  const handleCopyTranscript = async () => {
    if (transcripts.length === 0) {
      toast.error('Transcript is empty');
      return;
    }

    const content = transcripts
      .map((item) => `[${formatTranscriptTime(item.audio_start_time)}] ${item.text}`)
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(content);
      toast.success('Transcript copied');
    } catch (_error) {
      toast.error('Failed to copy transcript');
    }
  };

  const handleClearNote = () => {
    const normalizedTitle = 'New note';
    setNoteTitle(normalizedTitle);

    if (currentMeetingId && isReady) {
      replaceNotes([], { immediate: true });
      setMeetingTitle(normalizedTitle);
      void recordingService.updateMeetingSessionTitle(normalizedTitle).catch(error => {
        console.error('Failed to reset meeting session title:', error);
      });
    } else {
      setDraftContent('');
      clearQuickNoteDraft();
    }

    setUpdatedAt(Date.now());
    toast.success('Live note cleared');
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
      const appendToMeetingId = appendTargetMeetingIdRef.current || undefined;
      const meetingId = await handleRecordingStop(stopResult.status === 'complete', {
        autoNavigate: false,
        showToast: false,
        appendToMeetingId,
        resumeBaselineCount: appendToMeetingId ? resumeBaselineCountRef.current : undefined,
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
      await handleRecordingStop(false);
    } finally {
      setIsStoppingSession(false);
    }
  };

  // The URL rewrite is this page's own, so it must not replay the route reset.
  const replaceWorkspaceUrl = (path: string, folderId: string | null, savedId: string | null) => {
    appliedRouteKeyRef.current = routeKeyFor(folderId, savedId);
    router.replace(path);
  };

  const showSavedSessionInUrl = (meetingId: string) => {
    replaceWorkspaceUrl(createSavedRecordingPath(meetingId, noteFolderId), noteFolderId, meetingId);
  };

  const handleStartRecording = async () => {
    try {
      await flushPendingSave(false);
      await titleSave.flush();
    } catch {
      return;
    }
    const currentText = noteText;
    const normalizedTitle = noteTitle.trim() || 'New note';
    // The live session opens with whatever was already written here.
    saveQuickNoteDraft(normalizedTitle, currentText, noteFolderId);

    if (!isRecordingWorkspace) {
      // The draft surface never captures audio; the recording route owns the session.
      router.push(createRecordingPath(noteFolderId));
      return;
    }

    // Switching identity resets the view without erasing the previous meeting.
    appendTargetMeetingIdRef.current = null;
    resumeBaselineCountRef.current = 0;
    sessionStorage.removeItem('resume_meeting_id');
    sessionStorage.removeItem('resume_baseline_count');
    setChatRecordingId(null);
    setChatInput('');
    setDraftContent(currentText);
    setAiSummary(null);
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
    sessionStorage.setItem('resume_meeting_id', savedMeetingId);
    sessionStorage.setItem('resume_baseline_count', String(resumeBaselineCountRef.current));

    // Stay on the saved note identity; only reopen the live capture.
    setIsTranscriptOpen(true);
    sessionRequestedRef.current = true;
    attachedToRunningSessionRef.current = false;

    try {
      await invoke('request_recording_start', { source: 'recording_resume' });
    } catch (error) {
      sessionRequestedRef.current = false;
      appendTargetMeetingIdRef.current = null;
      sessionStorage.removeItem('resume_meeting_id');
      sessionStorage.removeItem('resume_baseline_count');
      console.error('Failed to resume recording:', error);
      toast.error('Failed to resume recording');
    }
  };

  const handleSaveDraft = async () => {
    if (librarySaveInFlight.current || activeNotesMeetingId || isLiveSessionVisible || !hasLoadedDraft) return;
    librarySaveInFlight.current = true;
    setIsSavingToLibrary(true);
    setDraftSaveError('');
    setIsDraftLocked(true);
    try {
      const saved = await saveDraftNote(noteTitle, draftContent, noteFolderId);
      await refetchMeetings().catch(() => {});
      const params = new URLSearchParams({ id: saved.meetingId });
      if (saved.folderId) params.set('folder', saved.folderId);
      router.push(`/meeting-details?${params}`);
    } catch (error) {
      setIsDraftLocked(Boolean(loadQuickNoteDraftForFolder(noteFolderId).saveId));
      setDraftSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      librarySaveInFlight.current = false;
      setIsSavingToLibrary(false);
    }
  };

  const handleGoHome = async () => {
    if (librarySaveInFlight.current) return;
    try {
      if (!activeNotesMeetingId) saveQuickNoteDraft(noteTitle, draftContent, noteFolderId);
      await flushPendingSave(false);
      await titleSave.flush();
      router.push(noteFolderId ? `/?view=all&folder=${encodeURIComponent(noteFolderId)}` : '/');
    } catch {
      // Keep the editor open so a failed note save can be retried.
    }
  };

  const handleEnhanceNotes = () => {
    if (!notesSourceReady) return;
    if (!savedMeetingId) return;
    setActiveSavedView('summary');
    void summaryGeneration.handleGenerateSummary();
  };

  const handleRecipe = (recipe: Recipe) => {
    if (!notesSourceReady || isChatLoading) return;
    setIsAiComposerOpen(true);
    const source = buildMeetingAnswerContext(transcripts, noteText, recipe.scope);
    if (!source.context.trim()) {
      toast.error('Add notes or record a transcript before asking about this meeting.');
      return;
    }
    void send(recipe.prompt, async () => source);
  };

  const handleSendChat = () => {
    if (!notesSourceReady || isChatLoading) return;
    setIsAiComposerOpen(true);
    const userPrompt = chatInput.trim();
    const source = buildMeetingAnswerContext(transcripts, noteText);
    if (!userPrompt) return;
    if (!source.context) {
      toast.error('Add notes or record a transcript before asking about this meeting.');
      return;
    }
    void send(userPrompt, async () => source);
    setChatInput('');
  };

  const handleEditorChange = (updatedBlocks: Block[]) => {
    setUpdatedAt(Date.now());
    saveNotes(updatedBlocks);
  };

  // Recording controls must remain visible even when WebKit stalls an animation.
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-stone-900">
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 pb-5 md:px-8">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-background py-4">
          <button
            type="button"
            onClick={() => void handleGoHome()}
            disabled={isSavingToLibrary}
            className="document-back"
          >
            <ArrowLeft className="h-4 w-4" />
            {noteFolderId ? 'Back to folder' : 'Home'}
          </button>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusPill
              icon={
                recordingState.status === RecordingStatus.STARTING ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : recordingState.isRecording ? (
                  <CircleDot className="h-3.5 w-3.5 text-red-500" />
                ) : recordingState.status === RecordingStatus.SAVING ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                )
              }
              subdued={isPostRecording}
            >
              {recordingState.status === RecordingStatus.STARTING
                ? 'Starting recording'
                : recordingState.isRecording
                  ? 'Recording live'
                  : recordingState.status === RecordingStatus.PROCESSING_TRANSCRIPTS
                    ? 'Finishing transcript'
                    : recordingState.status === RecordingStatus.SAVING
                      ? 'Saving meeting'
                      : 'Ready'}
            </StatusPill>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Note actions"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={handleCopyNote}>Copy note</DropdownMenuItem>
                {!isPostRecording && <DropdownMenuItem disabled={isDraftLocked} onSelect={handleClearNote}>Clear note</DropdownMenuItem>}
                {isPostRecording && <DropdownMenuItem onSelect={() => void handleStartRecording()}><Mic className="mr-2 h-4 w-4" />New recording</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            {recordingState.isRecording && (
              <Button
                className="rounded-md bg-stone-900 text-white hover:bg-stone-800"
                onClick={handleStopSession}
                disabled={isStoppingSession}
              >
                {isStoppingSession ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Stopping...
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4 fill-current" />
                    Stop
                  </>
                )}
              </Button>
            )}
            {!isRecordingWorkspace && !activeNotesMeetingId && !isLiveSessionVisible && (
              <Button onClick={() => void handleSaveDraft()} disabled={isSavingToLibrary || !hasLoadedDraft || !draftContent.trim()}>
                {isSavingToLibrary && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSavingToLibrary ? 'Saving…' : isDraftLocked ? 'Retry save' : 'Save note'}
              </Button>
            )}
            {!isLiveSessionVisible && !isPostRecording && (
              <Button
                className="rounded-md bg-stone-900 text-white hover:bg-stone-800"
                onClick={handleStartRecording}
                disabled={isDraftLocked}
              >
                <Mic className="h-4 w-4" />
                Start recording
              </Button>
            )}
          </div>
        </div>

        {noteFolderId && <p className="mt-3 flex min-w-0 items-center gap-2 text-sm text-stone-500"><Folder className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{noteFolder?.name || 'Selected folder'}</span></p>}
        {isDraftLocked && !isSavingToLibrary && <p role="status" className="mt-3 text-sm text-stone-600">{draftSaveError ? `Could not save: ${draftSaveError}. ` : ''}Your draft is retained. Choose Retry save to finish saving and continue editing.</p>}
        {draftSaveError && !isDraftLocked && <p role="status" className="mt-3 text-sm text-stone-600">Could not save: {draftSaveError}</p>}
        {loadError && <p role="status" className="mt-3 text-sm text-stone-600">Could not load written notes. <button type="button" onClick={retryLoad} className="underline">Retry loading notes</button></p>}
        {isPostRecording ? (
          <div className="mt-3 flex min-h-0 flex-col gap-4 pb-8">
            <section className="flex min-h-0 flex-1 flex-col">
              <div className="document-header">
                <div className="space-y-4">
                  <textarea
                    ref={titleRef}
                    value={noteTitle}
                    readOnly={isDraftLocked}
                    onChange={(event) => handleTitleChange(event.target.value)}
                    placeholder="New note"
                    rows={1}
                    aria-label="Meeting title"
                    className="document-title font-serif font-normal"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                    <InlineMeta>
                      <Mic className="h-3.5 w-3.5" />
                      Saved note
                    </InlineMeta>
                    <MetaDot />
                    <InlineMeta>{formatSavedAt(updatedAt)}</InlineMeta>
                    <MetaDot />
                    <NoteSaveStatus saving={isSaving || isSummarySaving || titleSave.status === 'saving'} dirty={isSummaryDirty} failed={saveError || summarySaveError || titleSave.status === 'error'} onRetry={() => { void Promise.all([flushPendingSave(true), titleSave.flush(), summaryRef.current?.saveSummary()]).catch(() => {}); }} />
                    <MetaDot />
                    <InlineMeta>
                      {savedTranscriptCount} transcript segment{savedTranscriptCount === 1 ? '' : 's'} saved
                    </InlineMeta>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <button
                        type="button"
                        onClick={() => setActiveSavedView('notes')}
                        aria-pressed={activeSavedView === 'notes'} className="document-tab"
                      >
                        Meeting Notes
                      </button>
                      {(aiSummary || isSummaryGenerating) && (
                        <button
                          type="button"
                          onClick={() => setActiveSavedView('summary')}
                          aria-pressed={activeSavedView === 'summary'} className="document-tab"
                        >
                          {aiSummary ? 'Enhanced Notes' : 'Enhancing…'}
                        </button>
                      )}
                    </div>

                    <Button ref={transcriptTriggerRef} variant="ghost" onClick={() => setIsTranscriptOpen(true)}>Transcript</Button>
                    {showEnhanceNotesCta && <EnhanceNotesCta disabled={!notesSourceReady} onClick={handleEnhanceNotes} />}
                    <div className="ml-auto rounded-md bg-white/75 p-1 ring-1 ring-stone-200/70">
                      <SummaryGeneratorButtonGroup
                        modelConfig={modelConfig}
                        setModelConfig={setModelConfig}
                        onSaveModelConfig={handleSaveModelConfig}
                        onGenerateSummary={summaryGeneration.handleGenerateSummary}
                        onStopGeneration={summaryGeneration.handleStopGeneration}
                        customPrompt=""
                        summaryStatus={summaryGeneration.summaryStatus}
                        availableTemplates={templates.availableTemplates}
                        selectedTemplate={templates.selectedTemplate}
                        onTemplateSelect={templates.handleTemplateSelection}
                        hasTranscripts={notesSourceReady && (savedTranscriptCount > 0 || !isNoteEmpty)}
                        isModelConfigLoading={false}
                        onOpenModelSettings={handleRegisterModalOpen}
                        showPrimaryAction={Boolean(aiSummary) || isSummaryGenerating}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-full py-5">
                {showSavedSummary ? (
                  <div className="document-editor">
                    <div className="h-full overflow-y-auto p-4">
                      <BlockNoteSummaryView
                        ref={summaryRef}
                        summaryData={aiSummary}
                        onSave={handleSaveSummary}
                        autoSave
                        onDirtyChange={setIsSummaryDirty}
                        onSavingChange={setIsSummarySaving}
                        onSummaryChange={(summary) => setAiSummary(summary)}
                        status={summaryGeneration.summaryStatus}
                        error={summaryGeneration.summaryError}
                        onRegenerateSummary={() => void summaryGeneration.handleRegenerateSummary()}
                        meeting={{
                          id: savedMeetingId || '',
                          title: noteTitle,
                          created_at: savedMeetingCreatedAt,
                        }}
                      />
                    </div>
                  </div>
                ) : shouldRenderEditor ? (
                  <div className="document-editor">
                    <Editor
                      key={activeNotesMeetingId || 'quick-note-draft'}
                      initialContent={blocks}
                      onChange={handleEditorChange}
                      editable={true}
                    />
                  </div>
                ) : isNoteEmpty ? (
                  <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg bg-white/76 ring-1 ring-stone-200/60">
                    <EmptyStateSummary
                      onGenerate={handleEnhanceNotes}
                      hasModel={Boolean(modelConfig.provider && modelConfig.model)}
                      isGenerating={summaryGeneration.summaryStatus === 'processing' || summaryGeneration.summaryStatus === 'summarizing' || summaryGeneration.summaryStatus === 'regenerating'}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-[240px] items-center justify-center rounded-lg bg-white/76 px-6 py-6 text-sm text-stone-500 ring-1 ring-stone-200/60">
                    {loadError ? 'Written notes are unavailable.' : 'Loading saved note…'}
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <section className="flex min-h-0 flex-col">
              <div className="document-header">
                <div className="space-y-4">
                  <textarea
                    ref={titleRef}
                    value={noteTitle}
                    readOnly={isDraftLocked}
                    onChange={(event) => handleTitleChange(event.target.value)}
                    placeholder="New note"
                    rows={1}
                    aria-label="Meeting title"
                    className="document-title font-serif font-normal"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusPill icon={<Mic className="h-3.5 w-3.5 text-stone-500" />}>
                      {currentMeetingId ? 'Live note' : isLiveSessionVisible ? 'Preparing session' : 'Not recording'}
                    </StatusPill>
                    <StatusPill>{formatSavedAt(updatedAt)}</StatusPill>
                    {isSaving && <StatusPill>Saving notes...</StatusPill>}
                    {isLiveSessionVisible && <button ref={transcriptTriggerRef} type="button" onClick={() => setIsTranscriptOpen(true)} className="ml-auto rounded-full border border-stone-200 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100">Transcript · {transcripts.length}</button>}
                  </div>
                </div>
              </div>

              {isLiveSessionVisible && <p className="mt-3 line-clamp-2 text-xs leading-5 text-stone-500" aria-label="Latest transcript passage">{transcripts.at(-1)?.text || 'Listening for speech. Open Transcript to follow the recording.'}</p>}

              <div className="min-h-0 py-5">
                {shouldRenderEditor ? (
                  <div className="document-editor">
                    <Editor
                      key={activeNotesMeetingId || 'quick-note-draft'}
                      initialContent={blocks}
                      onChange={handleEditorChange}
                      editable={true}
                    />
                  </div>
                ) : shouldRenderPendingTextarea ? (
                  <textarea
                    value={draftContent}
                    readOnly={isDraftLocked}
                    onChange={(event) => {
                      setDraftContent(event.target.value);
                      setUpdatedAt(Date.now());
                    }}
                    placeholder={isLiveSessionVisible ? 'Write notes while recording spins up...' : 'Write your notes. Changes are saved locally.'}
                    className="document-editor resize-y px-8 outline-none placeholder:text-stone-500"
                  />
                ) : (
                  <div className="document-editor flex items-center justify-center text-sm text-stone-500">
                    {loadError ? 'Written notes are unavailable.' : 'Loading saved note…'}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
      </div>
      {isPostRecording && !recordingState.isRecording && (
        <div className="pointer-events-none fixed bottom-6 left-6 z-30">
          <Button
            type="button"
            className="pointer-events-auto rounded-full bg-white text-stone-900 shadow-lg ring-1 ring-stone-200 hover:bg-stone-50"
            onClick={() => void handleResumeRecording()}
            disabled={isStoppingSession}
          >
            <Mic className="h-4 w-4 text-red-500" />
            Resume
          </Button>
        </div>
      )}
      {(isLiveSessionVisible || isPostRecording) && <MeetingAssistantDock
        expanded={isAiComposerOpen} onExpandedChange={setIsAiComposerOpen}
        messages={messages} loading={isChatLoading} input={chatInput} onInputChange={setChatInput}
        onSend={handleSendChat} onStop={stop} onClear={clearMessages}
        canSend={chatReady && notesSourceReady && Boolean(noteText.trim() || transcripts.length)}
        historyStatus={historyError || (!chatReady ? 'Loading conversation…' : undefined)}
        onRetryHistory={historyError ? retryHistory : undefined}
        recipes={RECIPES.map(recipe => ({ label: recipe.label, onSelect: () => handleRecipe(recipe) }))}
      />}
      <Sheet open={isTranscriptOpen} onOpenChange={setIsTranscriptOpen}>
        <SheetContent
          side="bottom"
          onCloseAutoFocus={event => { event.preventDefault(); transcriptTriggerRef.current?.focus(); }}
          className="h-[78dvh] rounded-t-xl border-stone-200 bg-white px-0 pb-0 pt-4"
        >
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-stone-200 px-6 pb-4">
              <div className="flex items-start justify-between gap-4 pr-10">
                <div>
                  <SheetTitle className="text-stone-900">Transcript</SheetTitle>
                  <SheetDescription className="text-stone-600">
                    {isLiveSessionVisible ? 'Updates as speech is captured. Your written notes remain separate.' : 'Review everything captured in this note and copy it when needed.'}
                  </SheetDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-md border-stone-200 bg-white"
                  onClick={handleCopyTranscript}
                >
                  <Copy className="h-4 w-4" />
                  Copy Transcript
                </Button>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="mx-auto max-w-3xl">
                {transcripts.length > 0 ? (
                  transcripts.map((item) => (
                    <div
                      key={item.id}
                      className="border-b border-stone-100 py-4 last:border-0"
                    >
                      <div className="mb-2 text-xs text-stone-400">
                        {formatTranscriptTime(item.audio_start_time)}
                      </div>
                      <p className="text-sm leading-7 text-stone-700">{item.text}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm leading-6 text-stone-500">
                    {isLiveSessionVisible ? 'Waiting for speech. New transcript passages will appear here.' : 'No transcript segments were captured for this note.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusPill({
  children,
  icon,
  subdued = false,
}: {
  children: ReactNode;
  icon?: ReactNode;
  subdued?: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 text-sm ${subdued ? 'text-stone-500' : 'text-stone-600'}`}
    >
      {icon}
      {children}
    </div>
  );
}

function MetaDot() {
  return <span className="text-stone-300">•</span>;
}

function InlineMeta({
  children,
}: {
  children: ReactNode;
}) {
  return <span className="inline-flex items-center gap-1.5 text-sm text-stone-500">{children}</span>;
}
