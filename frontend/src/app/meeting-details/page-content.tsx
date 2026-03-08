"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowLeft,
  Copy,
  FolderOpen,
  Loader2,
  Save,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Summary } from '@/types';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { BlockNoteSummaryView } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { SummaryGeneratorButtonGroup } from '@/components/MeetingDetails/SummaryGeneratorButtonGroup';
import { blocksToPlainText, parseStoredMeetingNotesJson } from '@/lib/meetingNotes';
import { buildEnhanceNotesPrompt } from '@/lib/enhanceNotes';
import Analytics from '@/lib/analytics';
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useLiveMeetingChat } from '@/hooks/useLiveMeetingChat';
import { useConfig } from '@/contexts/ConfigContext';
import type { ModelConfig } from '@/components/ModelSettingsModal';
import { EnhanceNotesCta } from '@/components/EnhanceNotesCta';

type Recipe = {
  label: string;
  prompt: string;
  scope: 'last5min' | 'full';
};

const RECIPES: Recipe[] = [
  {
    label: 'Write follow up email',
    prompt: 'Write a concise follow-up email based on this meeting. Keep it practical and ready to send.',
    scope: 'full',
  },
  {
    label: 'List my todos',
    prompt: 'List the concrete action items from this meeting as a concise checklist.',
    scope: 'full',
  },
  {
    label: 'Make notes longer',
    prompt: 'Expand the meeting notes into fuller, better organized notes without inventing facts.',
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

function formatSavedAt(timestamp?: string) {
  if (!timestamp) return 'Stored locally on this Mac';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'Stored locally on this Mac';
  return `Updated ${parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function getScopedTranscript(
  transcripts: { text: string; audio_start_time?: number | null }[],
  scope: Recipe['scope'],
) {
  if (scope === 'full' || transcripts.length === 0) {
    return transcripts.map((item) => item.text).join('\n');
  }

  const latest = transcripts[transcripts.length - 1]?.audio_start_time ?? 0;
  const cutoff = latest - 300;
  return transcripts
    .filter((item) => item.audio_start_time == null || item.audio_start_time >= cutoff)
    .map((item) => item.text)
    .join('\n');
}

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onRefetchTranscripts,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: any;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const [notesText, setNotesText] = useState('');
  const [activeView, setActiveView] = useState<'notes' | 'summary'>('notes');
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isAiComposerOpen, setIsAiComposerOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const { modelConfig, setModelConfig } = useConfig();
  const templates = useTemplates();
  const { messages, isLoading: isChatLoading, send, clearMessages } = useLiveMeetingChat();

  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });
  const meetingOperations = useMeetingOperations({ meeting });

  const handleRegisterModalOpen = (openFn: () => void) => {
    openModelSettingsRef.current = openFn;
  };

  const handleOpenModelSettings = () => {
    openModelSettingsRef.current?.();
  };

  const handleSaveModelConfig = async (config?: ModelConfig) => {
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

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig,
    isModelConfigLoading: false,
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  useEffect(() => {
    setNotesText('');
    setActiveView(summaryData ? 'summary' : 'notes');

    invoke<{ notes_json?: string | null; notes_markdown?: string | null } | null>('get_meeting_notes', {
      meetingId: meeting.id,
    })
      .then((result) => {
        const markdown = result?.notes_markdown?.trim();
        if (markdown) {
          setNotesText(markdown);
          return;
        }

        const parsedBlocks = parseStoredMeetingNotesJson(result?.notes_json);
        const fallbackText = blocksToPlainText(parsedBlocks);
        if (fallbackText) {
          setNotesText(fallbackText);
        }
      })
      .catch(() => {
        // no notes saved for this meeting
      });
  }, [meeting.id, summaryData]);

  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0 && !cancelled) {
        setActiveView('summary');
        await summaryGeneration.handleGenerateSummary('');
        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    void autoGenerate();

    return () => {
      cancelled = true;
    };
  }, [meeting.id, meetingData.transcripts.length, onAutoGenerateComplete, shouldAutoGenerate]);

  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;

    element.style.height = '0px';
    const nextHeight = Math.min(element.scrollHeight, 180);
    element.style.height = `${nextHeight}px`;
  }, [meetingData.meetingTitle]);

  useEffect(() => {
    if (!meetingData.aiSummary) {
      setActiveView('notes');
      return;
    }

    if (!notesText.trim()) {
      setActiveView('summary');
    }
  }, [meetingData.aiSummary, notesText]);

  const transcriptSegments = useMemo(() => {
    if (segments && segments.length > 0) {
      return segments;
    }
    return meetingData.transcripts;
  }, [meetingData.transcripts, segments]);

  const transcriptCount = totalCount ?? meetingData.transcripts.length;
  const isNotesEmpty = notesText.trim().length === 0;
  const isSummaryGenerating =
    summaryGeneration.summaryStatus === 'processing' ||
    summaryGeneration.summaryStatus === 'summarizing' ||
    summaryGeneration.summaryStatus === 'regenerating';
  const isComposerExpanded = isAiComposerOpen || isChatLoading;
  const enhanceNotesPrompt = useMemo(() => buildEnhanceNotesPrompt(notesText), [notesText]);
  const showEnhanceNotesCta = !meetingData.aiSummary && !isSummaryGenerating;
  const titleSizeClass =
    meetingData.meetingTitle.trim().length > 52
      ? 'text-3xl leading-[1.05] lg:text-[2.55rem]'
      : 'text-4xl leading-[0.98] lg:text-5xl';

  const handleEnhanceNotes = () => {
    setActiveView('summary');
    void summaryGeneration.handleGenerateSummary(enhanceNotesPrompt);
  };

  const handleRecipe = (recipe: Recipe) => {
    setIsAiComposerOpen(true);
    const transcriptContext = getScopedTranscript(meetingData.transcripts, recipe.scope);
    if (!transcriptContext.trim()) {
      toast.error('No transcript context available yet');
      return;
    }
    void send(recipe.prompt, transcriptContext);
  };

  const handleSendChat = () => {
    const userPrompt = chatInput.trim();
    const transcriptContext = meetingData.transcripts.map((item: any) => item.text).join('\n');
    if (!userPrompt || !transcriptContext.trim()) return;
    setIsAiComposerOpen(true);
    void send(userPrompt, transcriptContext);
    setChatInput('');
  };

  const handleCopyNotes = async () => {
    if (!notesText.trim()) {
      toast.error('Meeting notes are empty');
      return;
    }

    try {
      await navigator.clipboard.writeText(`${meetingData.meetingTitle}\n\n${notesText}`);
      toast.success('Meeting notes copied');
    } catch (error) {
      toast.error('Failed to copy meeting notes');
    }
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
            <Button variant="outline" className="rounded-full border-stone-200/75 bg-white/65 text-stone-600 shadow-none" onClick={meetingOperations.handleOpenMeetingFolder}>
              <FolderOpen className="h-4 w-4" />
              Folder
            </Button>
            <Button variant="outline" className="rounded-full border-stone-200/75 bg-white/65 text-stone-600 shadow-none" onClick={meetingData.saveAllChanges}>
              {meetingData.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </Button>
          </div>
        </div>

        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4 pb-36">
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="mx-auto w-full max-w-[980px] border-b border-stone-200/70 px-2 py-3 lg:px-1 lg:py-4">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-400">
                  <Wand2 className="h-3.5 w-3.5" />
                  Saved meeting
                </div>

                <textarea
                  ref={titleRef}
                  value={meetingData.meetingTitle}
                  onChange={(event) => meetingData.handleTitleChange(event.target.value)}
                  placeholder="Untitled meeting"
                  rows={1}
                  className={`w-full resize-none overflow-hidden border-0 bg-transparent px-0 font-semibold tracking-tight text-stone-900 outline-none placeholder:text-stone-400 ${titleSizeClass}`}
                />

                <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                  <InlineMeta>{new Date(meeting.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</InlineMeta>
                  <MetaDot />
                  <InlineMeta>{formatSavedAt(meeting.updated_at || meeting.created_at)}</InlineMeta>
                  <MetaDot />
                  <InlineMeta>{transcriptCount} transcript segment{transcriptCount === 1 ? '' : 's'}</InlineMeta>
                  {meetingData.isSaving && (
                    <>
                      <MetaDot />
                      <InlineMeta>Saving…</InlineMeta>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex rounded-full bg-stone-100/70 p-1">
                    <button
                      type="button"
                      onClick={() => setActiveView('notes')}
                      disabled={isNotesEmpty}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                        activeView === 'notes'
                          ? 'bg-white text-stone-900 shadow-sm'
                          : 'text-stone-600 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50'
                      }`}
                    >
                      Meeting Notes
                    </button>
                    {(meetingData.aiSummary || isSummaryGenerating) && (
                      <button
                        type="button"
                        onClick={() => setActiveView('summary')}
                        className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                          activeView === 'summary'
                            ? 'bg-white text-stone-900 shadow-sm'
                            : 'text-stone-600 hover:text-stone-900'
                        }`}
                      >
                        {meetingData.aiSummary ? 'Enhanced Notes' : 'Enhancing…'}
                      </button>
                    )}
                  </div>

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {activeView === 'notes' ? (
                      <Button variant="outline" className="rounded-full border-stone-200/75 bg-white/65 text-stone-600 shadow-none" onClick={handleCopyNotes}>
                        <Copy className="h-4 w-4" />
                        Copy Notes
                      </Button>
                    ) : meetingData.aiSummary ? (
                      <Button variant="outline" className="rounded-full border-stone-200/75 bg-white/65 text-stone-600 shadow-none" onClick={copyOperations.handleCopySummary}>
                        <Copy className="h-4 w-4" />
                        Copy Summary
                      </Button>
                    ) : null}

                    <div className="rounded-full bg-white/65 p-1 ring-1 ring-stone-200/60">
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
                        hasTranscripts={meetingData.transcripts.length > 0}
                        isModelConfigLoading={false}
                        onOpenModelSettings={handleRegisterModalOpen}
                        showPrimaryAction={Boolean(meetingData.aiSummary) || isSummaryGenerating}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-auto flex min-h-0 w-full max-w-[980px] flex-1 px-2 py-5 lg:px-1 lg:py-6">
              {activeView === 'summary' ? (
                meetingData.aiSummary ? (
                  <div className="h-full min-h-[420px] overflow-hidden rounded-[24px] bg-white/78 ring-1 ring-stone-200/60 shadow-[0_18px_40px_-34px_rgba(41,37,36,0.18)]">
                    <div className="h-full overflow-y-auto p-4">
                      <BlockNoteSummaryView
                        ref={meetingData.blockNoteSummaryRef}
                        summaryData={meetingData.aiSummary}
                        onSave={meetingData.handleSaveSummary}
                        onSummaryChange={meetingData.handleSummaryChange}
                        status={summaryGeneration.summaryStatus}
                        error={summaryGeneration.summaryError}
                        onRegenerateSummary={() => void summaryGeneration.handleRegenerateSummary()}
                        meeting={{
                          id: meeting.id,
                          title: meetingData.meetingTitle,
                          created_at: meeting.created_at,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center rounded-[24px] bg-white/76 ring-1 ring-stone-200/60 shadow-[0_18px_40px_-34px_rgba(41,37,36,0.18)]">
                    <EmptyStateSummary
                      onGenerate={handleEnhanceNotes}
                      hasModel={Boolean(modelConfig.provider && modelConfig.model)}
                      isGenerating={summaryGeneration.summaryStatus === 'processing' || summaryGeneration.summaryStatus === 'summarizing' || summaryGeneration.summaryStatus === 'regenerating'}
                    />
                  </div>
                )
              ) : !isNotesEmpty ? (
                <div className="h-full min-h-[420px] overflow-y-auto rounded-[24px] bg-white/76 px-6 py-6 text-base leading-8 text-stone-700 whitespace-pre-wrap ring-1 ring-stone-200/60 shadow-[0_18px_40px_-34px_rgba(41,37,36,0.18)]">
                  {notesText}
                </div>
              ) : (
                <div className="flex h-full min-h-[420px] items-center justify-center rounded-[24px] bg-white/76 ring-1 ring-stone-200/60 shadow-[0_18px_40px_-34px_rgba(41,37,36,0.18)]">
                  <EmptyStateSummary
                    onGenerate={handleEnhanceNotes}
                    hasModel={Boolean(modelConfig.provider && modelConfig.model)}
                    isGenerating={summaryGeneration.summaryStatus === 'processing' || summaryGeneration.summaryStatus === 'summarizing' || summaryGeneration.summaryStatus === 'regenerating'}
                  />
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
                      {RECIPES.map((recipe) => (
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
                      {messages.length > 0 && (
                        <button
                          type="button"
                          onClick={clearMessages}
                          className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-700"
                        >
                          Clear
                        </button>
                      )}
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
                        disabled={isChatLoading || !chatInput.trim() || meetingData.transcripts.length === 0}
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
                      <p className="text-xs text-stone-500">Open follow-up prompts, recap recipes, and Q&A for this meeting.</p>
                    </div>
                    <div className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600">
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
                        Review everything captured in this meeting and copy it when needed.
                      </SheetDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {onRefetchTranscripts && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full border-stone-200 bg-white"
                          onClick={() => void onRefetchTranscripts()}
                        >
                          <Loader2 className={`h-4 w-4 ${isLoadingMore ? 'animate-spin' : ''}`} />
                          Refresh
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full border-stone-200 bg-white"
                        onClick={copyOperations.handleCopyTranscript}
                      >
                        <Copy className="h-4 w-4" />
                        Copy Transcript
                      </Button>
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="mx-auto max-w-4xl space-y-3">
                    {transcriptSegments.length > 0 ? (
                      transcriptSegments.map((item: any) => (
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
                        No transcript segments were captured for this meeting.
                      </div>
                    )}

                    {hasMore && onLoadMore && (
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="outline"
                          className="rounded-full border-stone-200 bg-white"
                          onClick={onLoadMore}
                          disabled={isLoadingMore}
                        >
                          {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Load more {loadedCount && totalCount ? `(${loadedCount}/${totalCount})` : ''}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
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

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/90 px-3 py-1.5 text-sm font-medium text-stone-600">
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
