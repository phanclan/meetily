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
} from 'lucide-react';
import { toast } from 'sonner';
import { Summary } from '@/types';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { MeetingAssistantDock } from '@/components/MeetingDetails/MeetingAssistantDock';
import { SearchableTranscript } from '@/components/MeetingDetails/SearchableTranscript';
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
  const transcriptButtonRef = useRef<HTMLButtonElement | null>(null);
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
    meeting: { ...meeting, title: meetingData.meetingTitle },
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
      if (meetingData.blockNoteSummaryRef.current?.isDirty && !await meetingData.saveAllChanges()) return;
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
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-stone-900"
    >
      <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Meeting document">
      <div className="document-shell !min-h-0 !max-w-3xl">
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
                <DropdownMenuItem onSelect={() => activeView === 'notes' ? handleCopyNotes() : copyOperations.handleCopySummary()}><Copy className="mr-2 h-4 w-4" />{activeView === 'notes' ? 'Copy meeting notes' : 'Copy enhanced notes'}</DropdownMenuItem>
                <DropdownMenuItem onSelect={meetingOperations.handleOpenMeetingFolder}><FolderOpen className="mr-2 h-4 w-4" />Open recording folder</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {activeView === 'summary' && <Button variant="outline" disabled={meetingData.isSaving || !meetingData.isSummaryDirty} className="rounded-md border-stone-200/75 text-stone-600 shadow-none" onClick={meetingData.saveAllChanges}>
              {meetingData.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save enhanced notes
            </Button>}
          </div>
        </div>

        <div className="mt-3 flex min-h-0 flex-col gap-4 pb-8">
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="document-header">
              <div className="space-y-3">
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
                  <NoteSaveStatus saving={notes.isSaving || meetingData.isSaving || meetingData.titleSave.status === 'saving'} dirty={meetingData.isSummaryDirty} failed={notes.saveError || meetingData.summarySaveError || meetingData.titleSave.status === 'error'} onRetry={() => { if (meetingData.summarySaveError) void meetingData.saveAllChanges(); else void flushNoteChanges().catch(() => {}); }} />
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

                  <Button ref={transcriptButtonRef} variant="ghost" onClick={() => setIsTranscriptOpen(true)}>Transcript</Button>

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {showEnhanceNotesCta && <EnhanceNotesCta onClick={handleEnhanceNotes} />}
                    <div>
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
                        hasSummary={Boolean(meetingData.aiSummary)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full py-5">
              <div hidden={activeView !== 'summary'}>
                {meetingData.aiSummary ? (
                  <div className="document-editor [&_.bn-editor]:!px-0">
                    <div className="h-full overflow-y-auto">
                      <BlockNoteSummaryView
                        ref={meetingData.blockNoteSummaryRef}
                        summaryData={meetingData.aiSummary}
                        onSave={meetingData.handleSaveSummary}
                        onSummaryChange={meetingData.handleSummaryChange}
                        onDirtyChange={meetingData.setIsSummaryDirty}
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
                )}
              </div>
              {activeView === 'notes' && (notes.isReady ? (
                <div className="document-editor [&_.bn-editor]:!px-0">
                  <Editor key={meeting.id} initialContent={notes.blocks} onChange={notes.saveNotes} editable />
                </div>
              ) : (
                <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg bg-white/76 ring-1 ring-stone-200/60">
                  <p>Loading notes… If this persists, reopen the meeting to retry.</p>
                </div>
              ))}
            </div>
          </section>

          <Sheet open={isTranscriptOpen} onOpenChange={setIsTranscriptOpen}>
            <SheetContent
              onCloseAutoFocus={event => { event.preventDefault(); transcriptButtonRef.current?.focus(); }}
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
                    <SearchableTranscript meetingId={meeting.id} transcripts={meetingData.transcripts} hasMore={Boolean(hasMore)} />

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
      </div>
      <MeetingAssistantDock
        expanded={isComposerExpanded} onExpandedChange={setIsAiComposerOpen}
        messages={messages} loading={isChatLoading} input={chatInput} onInputChange={setChatInput}
        onSend={handleSendChat} onClear={clearMessages}
        canSend={Boolean(notesText.trim() || meetingData.transcripts.length)}
        recipes={RECIPES.map(recipe => ({ label: recipe.label, onSelect: () => handleRecipe(recipe) }))}
      />
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
