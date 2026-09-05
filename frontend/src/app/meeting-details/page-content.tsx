"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { useMeetingNotes } from '@/hooks/useMeetingNotes';
import { useAutoSizeTitle } from '@/hooks/useAutoSizeTitle';
import { NoteSaveStatus } from '@/components/NoteSaveStatus';
import {
  ArrowLeft,
  Copy,
  FolderOpen,
  MoreHorizontal,
  Loader2,
  Save,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Summary } from '@/types';
import { SavedTranscriptRows } from '@/components/MeetingDetails/SavedTranscriptRows';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AssistantMessage } from '@/components/AssistantMessage';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { BlockNoteSummaryView } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { SummaryGeneratorButtonGroup } from '@/components/MeetingDetails/SummaryGeneratorButtonGroup';
import { blocksToPlainText } from '@/lib/meetingNotes';
import { buildEnhanceNotesPrompt } from '@/lib/enhanceNotes';
import { buildMeetingContext } from '@/lib/meetingContext';
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

const Editor = dynamic(() => import('@/components/BlockNoteEditor/Editor'), { ssr: false });

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
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  const router = useRouter();
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const notes = useMeetingNotes(meeting.id);
  const notesText = useMemo(() => blocksToPlainText(notes.blocks), [notes.blocks]);
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
    notesText,
    modelConfig,
    isModelConfigLoading: false,
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  useEffect(() => {
    setActiveView(summaryData ? 'summary' : 'notes');
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

  useAutoSizeTitle(titleRef, meetingData.meetingTitle);

  useEffect(() => {
    if (!meetingData.aiSummary) {
      setActiveView('notes');
      return;
    }

  }, [meetingData.aiSummary]);

  const transcriptCount = totalCount ?? meetingData.transcripts.length;
  const isNotesEmpty = notesText.trim().length === 0;
  const isSummaryGenerating =
    summaryGeneration.summaryStatus === 'processing' ||
    summaryGeneration.summaryStatus === 'summarizing' ||
    summaryGeneration.summaryStatus === 'regenerating';
  const isComposerExpanded = isAiComposerOpen || isChatLoading;
  const enhanceNotesPrompt = useMemo(() => buildEnhanceNotesPrompt(notesText), [notesText]);
  const showEnhanceNotesCta = !meetingData.aiSummary && !isSummaryGenerating;


  const handleEnhanceNotes = () => {
    setActiveView('summary');
    void summaryGeneration.handleGenerateSummary(enhanceNotesPrompt);
  };

  const flushNoteChanges = async () => {
    await Promise.all([notes.flushPendingSave(true), meetingData.titleSave.flush()]);
  };

  const handleGoHome = async () => {
    try {
      await flushNoteChanges();
      router.push('/');
    } catch {
      toast.error('Changes are not saved. Retry before leaving.');
    }
  };

  const handleRecipe = (recipe: Recipe) => {
    setIsAiComposerOpen(true);
    const transcriptContext = buildMeetingContext(getScopedTranscript(meetingData.transcripts, recipe.scope), notesText);
    if (!transcriptContext.trim()) {
      toast.error('Add notes or record a transcript before asking about this meeting.');
      return;
    }
    void send(recipe.prompt, transcriptContext);
  };

  const handleSendChat = () => {
    const userPrompt = chatInput.trim();
    const transcriptContext = buildMeetingContext(meetingData.transcripts.map((item: any) => item.text).join('\n'), notesText);
    if (!userPrompt) return;
    if (!transcriptContext) {
      toast.error('Add notes or record a transcript before asking about this meeting.');
      return;
    }
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
      className="document-page"
    >
      <div className="document-shell">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => void handleGoHome()}
            className="document-back"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </button>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Meeting actions"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={meetingOperations.handleOpenMeetingFolder}><FolderOpen className="mr-2 h-4 w-4" />Open recording folder</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {activeView === 'summary' && <Button variant="outline" className="rounded-md border-stone-200/75 bg-white/65 text-stone-600 shadow-none" onClick={meetingData.saveAllChanges}>
              {meetingData.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save enhanced notes
            </Button>}
          </div>
        </div>

        <div className="mt-3 flex min-h-0 flex-col gap-4 pb-8">
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="document-header">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-stone-500">
                  <Wand2 className="h-3.5 w-3.5" />
                  Saved meeting
                </div>

                <textarea
                  ref={titleRef}
                  value={meetingData.meetingTitle}
                  onChange={(event) => meetingData.handleTitleChange(event.target.value)}
                  placeholder="Untitled meeting"
                  rows={1}
                  className="document-title"
                />

                <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                  <InlineMeta>{new Date(meeting.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</InlineMeta>
                  <MetaDot />
                  <InlineMeta>{formatSavedAt(meeting.updated_at || meeting.created_at)}</InlineMeta>
                  <MetaDot />
                  <InlineMeta>{transcriptCount} transcript segment{transcriptCount === 1 ? '' : 's'}</InlineMeta>
                  <MetaDot />
                  <NoteSaveStatus saving={notes.isSaving || meetingData.titleSave.status === 'saving'} failed={notes.saveError || meetingData.titleSave.status === 'error'} onRetry={() => { void flushNoteChanges().catch(() => {}); }} />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setActiveView('notes')}
                      aria-pressed={activeView === 'notes'}
                      className="document-tab"
                    >
                      Meeting Notes
                    </button>
                    {(meetingData.aiSummary || isSummaryGenerating) && (
                      <button
                        type="button"
                        onClick={() => setActiveView('summary')}
                        aria-pressed={activeView === 'summary'}
                      className="document-tab"
                      >
                        {meetingData.aiSummary ? 'Enhanced Notes' : 'Enhancing…'}
                      </button>
                    )}
                  </div>

                  <Button variant="ghost" onClick={() => setIsTranscriptOpen(true)}>Transcript</Button>

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {showEnhanceNotesCta && <EnhanceNotesCta onClick={handleEnhanceNotes} />}
                    {activeView === 'notes' ? (
                      <Button variant="outline" className="rounded-md border-stone-200/75 bg-white/65 text-stone-600 shadow-none" onClick={handleCopyNotes}>
                        <Copy className="h-4 w-4" />
                        Copy Notes
                      </Button>
                    ) : meetingData.aiSummary ? (
                      <Button variant="outline" className="rounded-md border-stone-200/75 bg-white/65 text-stone-600 shadow-none" onClick={copyOperations.handleCopySummary}>
                        <Copy className="h-4 w-4" />
                        Copy Summary
                      </Button>
                    ) : null}

                    <div className="rounded-md bg-white/65 p-1 ring-1 ring-stone-200/60">
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
                        hasTranscripts={meetingData.transcripts.length > 0 || !isNotesEmpty}
                        isModelConfigLoading={false}
                        onOpenModelSettings={handleRegisterModalOpen}
                        showPrimaryAction={Boolean(meetingData.aiSummary) || isSummaryGenerating}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full py-5">
              {activeView === 'summary' ? (
                meetingData.aiSummary ? (
                  <div className="document-editor">
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
                  <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg bg-white/76 ring-1 ring-stone-200/60">
                    <EmptyStateSummary
                      onGenerate={handleEnhanceNotes}
                      hasModel={Boolean(modelConfig.provider && modelConfig.model)}
                      isGenerating={summaryGeneration.summaryStatus === 'processing' || summaryGeneration.summaryStatus === 'summarizing' || summaryGeneration.summaryStatus === 'regenerating'}
                    />
                  </div>
                )
              ) : notes.isReady ? (
                <div className="document-editor">
                  <Editor key={meeting.id} initialContent={notes.blocks} onChange={notes.saveNotes} editable />
                </div>
              ) : (
                <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg bg-white/76 ring-1 ring-stone-200/60">
                  <p>Loading notes… If this persists, reopen the meeting to retry.</p>
                </div>
              )}
            </div>
          </section>

          <div className="border-t border-stone-200 pt-4">
            <div className="mx-auto flex w-full items-end gap-3">
              <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-stone-200/70 bg-white/84">
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
                            {message.role === 'assistant' ? <AssistantMessage content={message.content} /> : message.content}
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
                          className="rounded-md border border-stone-200/75 bg-stone-50/80 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {recipe.label}
                        </button>
                      ))}
                      {messages.length > 0 && (
                        <button
                          type="button"
                          onClick={clearMessages}
                          className="rounded-md border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-700"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsAiComposerOpen(false)}
                        className="ml-auto rounded-md border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-700"
                      >
                        Collapse
                      </button>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg border border-stone-200/80 bg-stone-50/80 p-2">
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
                        className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-sm text-stone-700 outline-none placeholder:text-stone-400"
                      />
                      <button
                        type="button"
                        onClick={handleSendChat}
                        disabled={isChatLoading || !chatInput.trim() || (!notesText.trim() && meetingData.transcripts.length === 0)}
                        aria-label="Send question"
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-stone-900 text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
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
                    <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-md bg-stone-100/85 md:flex text-stone-700">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-stone-900">Ask anything</p>
                      <p className="hidden text-xs text-stone-500 md:block">Open follow-up prompts, recap recipes, and Q&A for this meeting.</p>
                    </div>
                    <div className="rounded-md border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600">
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
              className="h-[78vh] rounded-t-xl border-stone-200 bg-white px-0 pb-0 pt-4"
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
                          className="rounded-md border-stone-200 bg-white"
                          onClick={() => void onRefetchTranscripts()}
                        >
                          <Loader2 className={`h-4 w-4 ${isLoadingMore ? 'animate-spin' : ''}`} />
                          Refresh
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-md border-stone-200 bg-white"
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
                    <SavedTranscriptRows transcripts={meetingData.transcripts} />

                    {hasMore && onLoadMore && (
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="outline"
                          className="rounded-md border-stone-200 bg-white"
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

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-stone-200 bg-white/90 px-3 py-1.5 text-sm font-medium text-stone-600">
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
