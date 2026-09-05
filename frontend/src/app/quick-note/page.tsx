'use client';

import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { appDataDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { saveMeetingNotes } from '@/meetnola/ipc';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Copy,
  Loader2,
  Mic,
  Pause,
  Send,
  Sparkles,
  Square,
  Wand2,
} from 'lucide-react';
import type { Block } from '@blocknote/core';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useMeetingNotes } from '@/hooks/useMeetingNotes';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { useLiveMeetingChat } from '@/hooks/useLiveMeetingChat';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { clearQuickNoteDraft, loadQuickNoteDraft, saveQuickNoteDraft } from '@/lib/quickNoteDraft';
import { blocksToPlainText, plainTextToBlocks } from '@/lib/meetingNotes';
import { recordingService } from '@/services/recordingService';
import { storageService } from '@/services/storageService';
import { Summary } from '@/types';
import { SummaryGeneratorButtonGroup } from '@/components/MeetingDetails/SummaryGeneratorButtonGroup';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { buildEnhanceNotesPrompt } from '@/lib/enhanceNotes';
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
  scope: 'last3min' | 'last5min' | 'full';
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

function getScopedTranscript(
  transcripts: { text: string; audio_start_time?: number | null }[],
  scope: Recipe['scope'],
) {
  if (scope === 'full' || transcripts.length === 0) {
    return transcripts.map(item => item.text).join('\n');
  }

  const latest = transcripts[transcripts.length - 1]?.audio_start_time ?? 0;
  const cutoff = latest - (scope === 'last5min' ? 300 : 180);
  return transcripts
    .filter(item => item.audio_start_time == null || item.audio_start_time >= cutoff)
    .map(item => item.text)
    .join('\n');
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

export default function QuickNotePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const freshToken = searchParams.get('fresh');
  const recordingState = useRecordingState();
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const summaryRef = useRef<BlockNoteSummaryViewRef>(null);
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const {
    currentMeetingId,
    meetingTitle,
    setMeetingTitle,
    transcripts,
    clearTranscripts,
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
  const [savedTranscriptCount, setSavedTranscriptCount] = useState(0);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isAiComposerOpen, setIsAiComposerOpen] = useState(false);
  const [activeSavedView, setActiveSavedView] = useState<'notes' | 'summary'>('notes');
  const [hydratedSessionId, setHydratedSessionId] = useState<string | null>(null);
  const [savedMeetingCreatedAt, setSavedMeetingCreatedAt] = useState<string>(new Date().toISOString());
  const [aiSummary, setAiSummary] = useState<Summary | null>(null);
  const activeNotesMeetingId = currentMeetingId ?? savedMeetingId;
  const {
    blocks,
    saveNotes,
    replaceNotes,
    flushPendingSave,
    isSaving,
    isReady,
  } = useMeetingNotes(activeNotesMeetingId);
  const { messages, isLoading: isChatLoading, send, clearMessages } = useLiveMeetingChat();

  const seededSessionIdsRef = useRef<Set<string>>(new Set());
  const autoStartRequestedRef = useRef(false);
  const consumedFreshTokenRef = useRef<string | null>(null);
  const titleSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useLayoutEffect(() => {
    const draft = loadQuickNoteDraft();
    autoStartRequestedRef.current = false;
    consumedFreshTokenRef.current = null;
    seededSessionIdsRef.current.clear();
    preSessionDraftRef.current = {
      title: draft.title,
      content: draft.content,
    };

    setSavedMeetingId(null);
    setSavedTranscriptCount(0);
    setIsTranscriptOpen(false);
    setIsAiComposerOpen(false);
    setActiveSavedView('notes');
    setHydratedSessionId(null);
    setAiSummary(null);
    clearTranscripts();
    setNoteTitle(draft.title);
    setDraftContent(draft.content);
    setUpdatedAt(draft.updatedAt);
    setHasLoadedDraft(true);
  }, [clearTranscripts, freshToken]);

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
    if (!hasLoadedDraft || currentMeetingId || isLiveSessionVisible || savedMeetingId) {
      return;
    }

    const saved = saveQuickNoteDraft(noteTitle, draftContent);
    setUpdatedAt(saved.updatedAt);
  }, [noteTitle, draftContent, hasLoadedDraft, currentMeetingId, isLiveSessionVisible, savedMeetingId]);

  useEffect(() => {
    let cancelled = false;

    const maybeAutoStart = async () => {
      const activeSession = await recordingService.getMeetingSession().catch(() => null);
      if (cancelled) return;

      if (activeSession || recordingState.isRecording) {
        return;
      }

      try {
        await invoke('request_recording_start', { source: 'quick_note_route' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Recording already in progress')) {
          return;
        }
        autoStartRequestedRef.current = false;
        console.error('Failed to auto-start quick note recording:', error);
        toast.error('Failed to start recording');
      }
    };

    if (
      !hasLoadedDraft ||
      !freshToken ||
      consumedFreshTokenRef.current === freshToken ||
      autoStartRequestedRef.current ||
      currentMeetingId ||
      isLiveSessionVisible ||
      savedMeetingId ||
      isStoppingSession
    ) {
      return;
    }

    autoStartRequestedRef.current = true;
    consumedFreshTokenRef.current = freshToken;
    void maybeAutoStart();

    return () => {
      cancelled = true;
    };
  }, [
    currentMeetingId,
    freshToken,
    hasLoadedDraft,
    isLiveSessionVisible,
    isStoppingSession,
    recordingState.isRecording,
    savedMeetingId,
  ]);

  useEffect(() => {
    if (!currentMeetingId || !hasLoadedDraft || !isReady) return;
    if (seededSessionIdsRef.current.has(currentMeetingId)) return;

    seededSessionIdsRef.current.add(currentMeetingId);
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
  }, [currentMeetingId, noteTitle, setMeetingTitle]);

  const noteText = useMemo(() => {
    if (activeNotesMeetingId && isReady) {
      return blocksToPlainText(blocks);
    }
    return draftContent;
  }, [activeNotesMeetingId, blocks, draftContent, isReady]);

  const liveTranscript = transcripts.slice(-16);
  const isPostRecording = !recordingState.isRecording && !isStoppingSession && Boolean(savedMeetingId);
  const shouldWaitForSessionHydration =
    Boolean(currentMeetingId) &&
    isReady &&
    hydratedSessionId !== currentMeetingId &&
    draftContent.trim().length > 0 &&
    blocks.length === 0;
  const shouldRenderEditor = Boolean(activeNotesMeetingId) && isReady && !shouldWaitForSessionHydration;
  const shouldRenderPendingTextarea = !shouldRenderEditor && !isPostRecording;
  const isNoteEmpty = noteText.trim().length === 0;
  const showSavedSummary = isPostRecording && activeSavedView === 'summary' && Boolean(aiSummary);
  const isComposerExpanded = isAiComposerOpen || isChatLoading;
  const enhanceNotesPrompt = useMemo(() => buildEnhanceNotesPrompt(noteText), [noteText]);
  const titleSizeClass =
    noteTitle.trim().length > 52
      ? 'text-3xl leading-[1.05] lg:text-[2.55rem]'
      : 'text-4xl leading-[0.98] lg:text-5xl';

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
    } catch (error) {
      console.error('Failed to save quick note summary:', error);
      toast.error('Failed to save summary');
    }
  };

  const summaryGeneration = useSummaryGeneration({
    meeting: summaryMeeting,
    transcripts: [],
    modelConfig,
    isModelConfigLoading: false,
    selectedTemplate: templates.selectedTemplate,
    updateMeetingTitle: (title: string) => {
      setNoteTitle(title);
      void invoke('api_save_meeting_title', {
        meetingId: savedMeetingId,
        title,
      }).catch(error => {
        console.error('Failed to persist AI-generated meeting title:', error);
      });
    },
    setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  const isSummaryGenerating =
    summaryGeneration.summaryStatus === 'processing' ||
    summaryGeneration.summaryStatus === 'summarizing' ||
    summaryGeneration.summaryStatus === 'regenerating';
  const showEnhanceNotesCta = isPostRecording && !aiSummary && !isSummaryGenerating;

  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;

    element.style.height = '0px';
    const nextHeight = Math.min(element.scrollHeight, 180);
    element.style.height = `${nextHeight}px`;
  }, [noteTitle]);

  useEffect(() => {
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

        if (meeting?.created_at) {
          setSavedMeetingCreatedAt(meeting.created_at);
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
      const snapshotBlocks = blocks.length > 0
        ? blocks
        : (draftContent.trim() ? plainTextToBlocks(draftContent) : []);
      const snapshotMarkdown = blocksToPlainText(snapshotBlocks);

      await flushPendingSave(false);

      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      const stopResult = await recordingService.stopRecording(savePath);
      const meetingId = await handleRecordingStop(stopResult.status === 'complete', {
        autoNavigate: false,
        showToast: false,
        onSaved: async (nextMeetingId) => {
          if (snapshotMarkdown.trim().length > 0 || snapshotBlocks.length > 0) {
            await saveMeetingNotes({
              meetingId: nextMeetingId,
              notesMarkdown: snapshotMarkdown,
              notesJson: JSON.stringify(snapshotBlocks),
            }).catch((error) => {
              console.error('Failed to persist quick note blocks to saved meeting:', error);
            });
          }

          setSavedMeetingId(nextMeetingId);
          setSavedTranscriptCount(transcripts.length);
          setIsTranscriptOpen(false);
          clearQuickNoteDraft();
          preSessionDraftRef.current = null;
        },
      });
      if (meetingId) {
        setSavedMeetingId(meetingId);
      }
    } catch (error) {
      console.error('Failed to stop quick note recording:', error);
      toast.error('Failed to stop recording');
      await handleRecordingStop(false);
    } finally {
      setIsStoppingSession(false);
    }
  };

  const handleResumeSession = async () => {
    const currentText = noteText;
    const normalizedTitle = noteTitle.trim() || 'New note';
    saveQuickNoteDraft(normalizedTitle, currentText);
    preSessionDraftRef.current = {
      title: normalizedTitle,
      content: currentText,
    };
    setSavedMeetingId(null);
    setSavedTranscriptCount(0);
    setIsTranscriptOpen(true);

    try {
      await invoke('request_recording_start', { source: 'quick_note_resume' });
    } catch (error) {
      console.error('Failed to resume quick note recording:', error);
      toast.error('Failed to resume recording');
    }
  };

  const handleEnhanceNotes = () => {
    if (!savedMeetingId) return;
    setActiveSavedView('summary');
    void summaryGeneration.handleGenerateSummary(enhanceNotesPrompt);
  };

  const handleRecipe = (recipe: Recipe) => {
    setIsAiComposerOpen(true);
    const transcriptContext = getScopedTranscript(transcripts, recipe.scope);
    if (!transcriptContext.trim()) {
      toast.error('No transcript context available yet');
      return;
    }
    void send(recipe.prompt, transcriptContext);
  };

  const handleSendChat = () => {
    setIsAiComposerOpen(true);
    const userPrompt = chatInput.trim();
    const transcriptContext = transcripts.map(item => item.text).join('\n');
    if (!userPrompt || !transcriptContext.trim()) return;
    void send(userPrompt, transcriptContext);
    setChatInput('');
  };

  const handleEditorChange = (updatedBlocks: Block[]) => {
    setUpdatedAt(Date.now());
    saveNotes(updatedBlocks);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="h-screen overflow-y-auto bg-[#f6f2ea] text-stone-900"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col px-5 py-5 md:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-2 rounded-full border border-stone-200/80 bg-white/65 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:border-stone-300 hover:bg-white/80"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
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

            <Button
              variant="outline"
              className={`rounded-full border-stone-200/75 bg-white/70 text-stone-600 shadow-none ${isPostRecording ? 'border-stone-200/60 bg-white/55 text-stone-500' : ''}`}
              onClick={handleCopyNote}
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            {!isPostRecording && (
              <Button
                variant="outline"
                className="rounded-full border-stone-200/75 bg-white/70 text-stone-600 shadow-none"
                onClick={handleClearNote}
              >
                Clear
              </Button>
            )}
            {recordingState.isRecording && (
              <Button
                className="rounded-full bg-stone-900 text-white hover:bg-stone-800"
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
            {isPostRecording && (
              <Button
                className="rounded-full bg-stone-900 text-white hover:bg-stone-800"
                onClick={handleResumeSession}
              >
                <Pause className="h-4 w-4" />
                Resume
              </Button>
            )}
          </div>
        </div>

        {isPostRecording ? (
          <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4 pb-36">
            <section className="flex min-h-0 flex-1 flex-col">
              <div className="mx-auto w-full max-w-[980px] border-b border-stone-200/70 px-2 py-3 lg:px-1 lg:py-4">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-400">
                    <Wand2 className="h-3.5 w-3.5" />
                    Captured note
                  </div>
                  <textarea
                    ref={titleRef}
                    value={noteTitle}
                    onChange={(event) => setNoteTitle(event.target.value)}
                    placeholder="New note"
                    rows={1}
                    className={`w-full resize-none overflow-hidden border-0 bg-transparent px-0 font-semibold tracking-tight text-stone-900 outline-none placeholder:text-stone-400 ${titleSizeClass}`}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                    <InlineMeta>
                      <Mic className="h-3.5 w-3.5" />
                      Saved note
                    </InlineMeta>
                    <MetaDot />
                    <InlineMeta>{formatSavedAt(updatedAt)}</InlineMeta>
                    {isSaving && (
                      <>
                        <MetaDot />
                        <InlineMeta>Saving notes…</InlineMeta>
                      </>
                    )}
                    <MetaDot />
                    <InlineMeta>
                      {savedTranscriptCount} transcript segment{savedTranscriptCount === 1 ? '' : 's'} saved
                    </InlineMeta>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex rounded-full bg-stone-100/70 p-1">
                      <button
                        type="button"
                        onClick={() => setActiveSavedView('notes')}
                        className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                          activeSavedView === 'notes'
                            ? 'bg-white text-stone-900 shadow-sm'
                            : 'text-stone-600 hover:text-stone-900'
                        }`}
                      >
                        Meeting Notes
                      </button>
                      {(aiSummary || isSummaryGenerating) && (
                        <button
                          type="button"
                          onClick={() => setActiveSavedView('summary')}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                            activeSavedView === 'summary'
                              ? 'bg-white text-stone-900 shadow-sm'
                              : 'text-stone-600 hover:text-stone-900'
                          }`}
                        >
                          {aiSummary ? 'Enhanced Notes' : 'Enhancing…'}
                        </button>
                      )}
                    </div>

                    <div className="ml-auto rounded-full bg-white/75 p-1 ring-1 ring-stone-200/70">
                      <SummaryGeneratorButtonGroup
                        modelConfig={modelConfig}
                        setModelConfig={setModelConfig}
                        onSaveModelConfig={handleSaveModelConfig}
                        onGenerateSummary={summaryGeneration.handleGenerateSummary}
                        onStopGeneration={summaryGeneration.handleStopGeneration}
                        customPrompt={enhanceNotesPrompt}
                        summaryStatus={summaryGeneration.summaryStatus}
                        availableTemplates={templates.availableTemplates}
                        selectedTemplate={templates.selectedTemplate}
                        onTemplateSelect={templates.handleTemplateSelection}
                        hasTranscripts={savedTranscriptCount > 0}
                        isModelConfigLoading={false}
                        onOpenModelSettings={handleRegisterModalOpen}
                        showPrimaryAction={Boolean(aiSummary) || isSummaryGenerating}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mx-auto flex min-h-0 w-full max-w-[980px] flex-1 px-2 py-5 lg:px-1 lg:py-6">
                {showSavedSummary ? (
                  <div className="h-full min-h-[420px] overflow-hidden rounded-[24px] bg-white/78 ring-1 ring-stone-200/60 shadow-[0_18px_40px_-34px_rgba(41,37,36,0.18)]">
                    <div className="h-full overflow-y-auto p-4">
                      <BlockNoteSummaryView
                        ref={summaryRef}
                        summaryData={aiSummary}
                        onSave={handleSaveSummary}
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
                  <div className="relative h-full min-h-[420px] overflow-hidden rounded-[24px] bg-white/76 px-3 py-3 ring-1 ring-stone-200/60 shadow-[0_18px_40px_-34px_rgba(41,37,36,0.18)] md:min-h-[560px]">
                    <Editor
                      key={activeNotesMeetingId || 'quick-note-draft'}
                      initialContent={blocks}
                      onChange={handleEditorChange}
                      editable={true}
                      showMoveControls={false}
                    />
                  </div>
                ) : isNoteEmpty ? (
                  <div className="flex h-full min-h-[420px] items-center justify-center rounded-[24px] bg-white/76 ring-1 ring-stone-200/60 shadow-[0_18px_40px_-34px_rgba(41,37,36,0.18)]">
                    <EmptyStateSummary
                      onGenerate={handleEnhanceNotes}
                      hasModel={Boolean(modelConfig.provider && modelConfig.model)}
                      isGenerating={summaryGeneration.summaryStatus === 'processing' || summaryGeneration.summaryStatus === 'summarizing' || summaryGeneration.summaryStatus === 'regenerating'}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center rounded-[24px] bg-white/76 px-6 py-6 text-sm text-stone-500 ring-1 ring-stone-200/60 shadow-[0_18px_40px_-34px_rgba(41,37,36,0.18)]">
                    Loading saved note...
                  </div>
                )}
              </div>
            </section>

            <div className="sticky bottom-4 z-30 mt-auto">
              {showEnhanceNotesCta && (
                <div className="mb-3 flex justify-center">
                  <EnhanceNotesCta onClick={handleEnhanceNotes} />
                </div>
              )}
              <div className="mx-auto flex max-w-[980px] items-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsTranscriptOpen(true)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-stone-200/70 bg-white/82 text-stone-700 shadow-[0_12px_28px_-24px_rgba(41,37,36,0.24)] transition-colors hover:border-stone-300 hover:bg-white"
                  title="Open transcript"
                >
                  <WaveGlyph />
                </button>

                <div className="flex-1 overflow-hidden rounded-[24px] border border-stone-200/70 bg-white/84 shadow-[0_16px_36px_-28px_rgba(41,37,36,0.2)]">
                  {isComposerExpanded ? (
                    <div className="p-4">
                      {messages.length > 0 && (
                        <div className="mb-4 max-h-52 space-y-3 overflow-y-auto pr-1">
                          {messages.map((message, index) => (
                            <div
                              key={`${message.role}-${index}`}
                              className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                                message.role === 'user'
                                  ? 'ml-auto bg-stone-900 text-white shadow-sm'
                                  : 'border border-stone-200/80 bg-stone-50 text-stone-700'
                              }`}
                            >
                              {message.content}
                            </div>
                          ))}
                          {isChatLoading && (
                        <div className="rounded-2xl bg-stone-100/85 px-4 py-3 text-sm text-stone-600">
                              <span className="inline-flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Thinking...
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {RECIPES.map(recipe => (
                          <button
                            key={recipe.label}
                            type="button"
                            onClick={() => handleRecipe(recipe)}
                            disabled={isChatLoading}
                            className="rounded-full border border-stone-200/75 bg-stone-50/80 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {recipe.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setIsAiComposerOpen(false)}
                          className="ml-auto rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-700"
                        >
                          Collapse
                        </button>
                      </div>

                      <div className="flex items-center gap-2 rounded-[22px] border border-stone-200/80 bg-stone-50/80 p-2">
                        <div className="flex items-center gap-2 pl-2 text-stone-400">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <input
                          value={chatInput}
                          onFocus={() => setIsAiComposerOpen(true)}
                          onChange={(event) => setChatInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              handleSendChat();
                            }
                          }}
                          placeholder="Ask anything about this meeting"
                          className="flex-1 border-0 bg-transparent px-2 py-2 text-sm text-stone-700 outline-none placeholder:text-stone-400"
                        />
                        <button
                          type="button"
                          onClick={handleSendChat}
                          disabled={isChatLoading || !chatInput.trim() || transcripts.length === 0}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsAiComposerOpen(true)}
                      className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100/85 text-stone-700">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-stone-900">Ask anything</p>
                        <p className="text-xs text-stone-500">Open follow-up prompts, action-item recipes, and Q&A for this meeting.</p>
                      </div>
                      <div className="rounded-full border border-stone-200/80 px-3 py-1.5 text-xs font-medium text-stone-600">
                        View recipes
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <Sheet open={isTranscriptOpen} onOpenChange={setIsTranscriptOpen}>
              <SheetContent
                side="bottom"
                className="h-[78vh] rounded-t-[30px] border-stone-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(248,246,240,0.98)_100%)] px-0 pb-0 pt-4"
              >
                <div className="flex h-full flex-col">
                  <SheetHeader className="border-b border-stone-200 px-6 pb-4">
                    <div className="flex items-start justify-between gap-4 pr-10">
                      <div>
                        <SheetTitle className="text-stone-900">Transcript</SheetTitle>
                        <SheetDescription className="text-stone-600">
                          Review everything captured in this note and copy it when needed.
                        </SheetDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full border-stone-200 bg-white"
                        onClick={handleCopyTranscript}
                      >
                        <Copy className="h-4 w-4" />
                        Copy Transcript
                      </Button>
                    </div>
                  </SheetHeader>

                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    <div className="mx-auto max-w-4xl space-y-3">
                      {transcripts.length > 0 ? (
                        transcripts.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-[24px] border border-stone-200 bg-white/90 px-4 py-4 shadow-sm"
                          >
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                              {formatTranscriptTime(item.audio_start_time)}
                            </div>
                            <p className="text-sm leading-7 text-stone-700">{item.text}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[24px] border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-sm leading-6 text-stone-500">
                          No transcript segments were captured for this note.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        ) : (
          <div className="mt-5 grid min-h-0 flex-1 gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.86fr)] xl:grid-cols-[minmax(0,1.4fr)_420px]">
            <section className="flex min-h-0 flex-col rounded-[32px] border border-white/70 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96)_0%,_rgba(252,249,243,0.96)_100%)] shadow-[0_28px_80px_-36px_rgba(41,37,36,0.42)] backdrop-blur">
              <div className="border-b border-stone-200/80 px-6 py-6 lg:px-8 lg:py-7">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                    <Wand2 className="h-3.5 w-3.5" />
                    Live note canvas
                  </div>
                  <textarea
                    ref={titleRef}
                    value={noteTitle}
                    onChange={(event) => setNoteTitle(event.target.value)}
                    placeholder="New note"
                    rows={1}
                    className={`w-full resize-none overflow-hidden border-0 bg-transparent px-0 font-semibold tracking-tight text-stone-900 outline-none placeholder:text-stone-400 ${titleSizeClass}`}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusPill icon={<Mic className="h-3.5 w-3.5 text-stone-500" />}>
                      {currentMeetingId ? 'Live note' : 'Preparing session'}
                    </StatusPill>
                    <StatusPill>{formatSavedAt(updatedAt)}</StatusPill>
                    {isSaving && <StatusPill>Saving notes...</StatusPill>}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 px-5 py-5 lg:px-8 lg:py-6">
                {shouldRenderEditor ? (
                  <div className="relative h-full min-h-[300px] overflow-hidden rounded-[28px] border border-stone-200/70 bg-[linear-gradient(180deg,_#fffdf8_0%,_#fbf7ef_100%)] px-2 py-2 md:min-h-[520px]">
                    <Editor
                      key={activeNotesMeetingId || 'quick-note-draft'}
                      initialContent={blocks}
                      onChange={handleEditorChange}
                      editable={true}
                      showMoveControls={true}
                    />
                  </div>
                ) : shouldRenderPendingTextarea ? (
                  <textarea
                    value={draftContent}
                    onChange={(event) => {
                      setDraftContent(event.target.value);
                      setUpdatedAt(Date.now());
                    }}
                    placeholder="Write notes while recording spins up..."
                    className="h-full min-h-[300px] w-full resize-none rounded-[28px] border border-stone-200/70 bg-[linear-gradient(180deg,_#fffdf8_0%,_#fbf7ef_100%)] px-6 py-6 text-lg leading-8 text-stone-800 outline-none placeholder:text-stone-400 md:min-h-[520px]"
                  />
                ) : (
                  <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-stone-200/70 bg-[linear-gradient(180deg,_#fffdf8_0%,_#fbf7ef_100%)] px-6 py-6 text-sm text-stone-500">
                    Loading saved note...
                  </div>
                )}
              </div>
            </section>

            <aside className="flex min-h-0 flex-col gap-4 md:sticky md:top-5 md:max-h-[calc(100vh-2.5rem)]">
              <section className="rounded-[28px] border border-stone-200/80 bg-white/90 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                      Live transcript
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-stone-900">
                      Listen and write at the same time
                    </h2>
                  </div>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
                    {transcripts.length} segments
                  </span>
                </div>

                <div className="mt-4 max-h-[220px] space-y-2 overflow-y-auto pr-1 lg:max-h-[260px]">
                  {liveTranscript.length > 0 ? (
                    liveTranscript.map(item => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3"
                      >
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                          {formatTranscriptTime(item.audio_start_time)}
                        </div>
                        <p className="text-sm leading-6 text-stone-700">{item.text}</p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-sm leading-6 text-stone-500">
                      Transcript will appear here once speech is detected.
                    </div>
                  )}
                </div>
              </section>

              <section className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-stone-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96)_0%,_rgba(247,246,241,0.98)_100%)] p-5 shadow-sm md:min-h-[320px]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                      AI copilot
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-stone-900">
                      Get to the useful part faster
                    </h2>
                  </div>
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={clearMessages}
                      className="text-xs font-medium text-stone-500 transition-colors hover:text-stone-700"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {RECIPES.map(recipe => (
                    <button
                      key={recipe.label}
                      type="button"
                      onClick={() => handleRecipe(recipe)}
                      disabled={isChatLoading}
                      className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {recipe.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                  {messages.length > 0 ? (
                    messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                          message.role === 'user'
                            ? 'bg-stone-900 text-white shadow-sm'
                            : 'border border-stone-200/80 bg-white/90 text-stone-700'
                        }`}
                      >
                        {message.content}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-sm leading-6 text-stone-500">
                      Ask for a recap, suggested topics, or action items while the meeting is still happening.
                    </div>
                  )}
                  {isChatLoading && (
                    <div className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-600">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Thinking...
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-[22px] border border-stone-200 bg-stone-50 p-2">
                  <div className="flex items-center gap-2 pl-2 text-stone-400">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <input
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSendChat();
                      }
                    }}
                    placeholder="Ask anything about this meeting"
                    className="flex-1 border-0 bg-transparent px-2 py-2 text-sm text-stone-700 outline-none placeholder:text-stone-400"
                  />
                  <button
                    type="button"
                    onClick={handleSendChat}
                    disabled={isChatLoading || !chatInput.trim() || transcripts.length === 0}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function WaveGlyph() {
  return (
    <span className="flex h-4 items-end gap-0.5">
      <span className="h-2 w-0.5 rounded-full bg-current opacity-70" />
      <span className="h-3.5 w-0.5 rounded-full bg-current" />
      <span className="h-2.5 w-0.5 rounded-full bg-current opacity-80" />
    </span>
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
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${
        subdued
          ? 'border border-stone-200/70 bg-white/60 text-stone-500'
          : 'border border-stone-200/85 bg-white/80 text-stone-600'
      }`}
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
