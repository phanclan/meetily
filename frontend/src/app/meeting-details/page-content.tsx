"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { useMeetingNotes } from '@/hooks/useMeetingNotes';
import { useAutoSizeTitle } from '@/hooks/useAutoSizeTitle';
import { NoteSaveStatus } from '@/components/NoteSaveStatus';
import {
  ArrowLeft,
  ChevronDown,
  FileText,
  Sparkles,
  Copy,
  FolderOpen,
  MoreHorizontal,
  Loader2,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { Summary } from '@/types';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { MeetingAssistantDock } from '@/components/MeetingDetails/MeetingAssistantDock';
import { SummaryClaimCheck } from '@/components/MeetingDetails/SummaryClaimCheck';
import { summaryClaimQuestion } from '@/lib/summaryClaim';
import { SearchableTranscript } from '@/components/MeetingDetails/SearchableTranscript';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BlockNoteSummaryView } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { SummaryGeneratorButtonGroup } from '@/components/MeetingDetails/SummaryGeneratorButtonGroup';
import { blocksToPlainText } from '@/lib/meetingNotes';
import { loadMeetingAnswerContext } from '@/lib/meetingAnswerContext';
import Analytics from '@/lib/analytics';
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useSavedMeetingChat } from '@/hooks/useSavedMeetingChat';
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
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sourcePanelRef = useRef<HTMLDivElement | null>(null);
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const notes = useMeetingNotes(meeting.id);
  const notesText = useMemo(() => blocksToPlainText(notes.blocks), [notes.blocks]);
  const [activeView, setActiveView] = useState<'notes' | 'summary'>('notes');
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [sourceView, setSourceView] = useState<'notes' | 'transcript'>('transcript');
  const openSources = (view: 'notes' | 'transcript', trigger: HTMLButtonElement) => {
    sourceTriggerRef.current = trigger;
    setSourceView(view);
    setIsSourcesOpen(true);
  };
  const [isAiComposerOpen, setIsAiComposerOpen] = useState(false);
  const [isClearChatOpen, setIsClearChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const { modelConfig, setModelConfig } = useConfig();
  const templates = useTemplates();
  const { messages, isLoading: isChatLoading, send, clearMessages, stop, ready: chatReady, historyError, retryHistory } = useSavedMeetingChat(meeting.id);

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
    notesReady: notes.isReady,
    modelConfig,
    isModelConfigLoading: false,
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
    beforeGenerate: async () => { await meetingData.blockNoteSummaryRef.current?.saveSummary(); },
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
      if (shouldAutoGenerate && notes.isReady && meetingData.transcripts.length > 0 && !cancelled) {
        setActiveView('summary');
        await summaryGeneration.handleGenerateSummary();
        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    void autoGenerate();

    return () => {
      cancelled = true;
    };
  }, [meeting.id, meetingData.transcripts.length, onAutoGenerateComplete, shouldAutoGenerate, notes.isReady]);

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
  const showEnhanceNotesCta = !meetingData.aiSummary && !isSummaryGenerating;


  const handleEnhanceNotes = () => {
    if (!notes.isReady) return;
    setActiveView('summary');
    void summaryGeneration.handleGenerateSummary();
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
    if (!chatReady || !notes.isReady || isChatLoading) return;
    setIsAiComposerOpen(true);
    void send(recipe.prompt, () => loadMeetingAnswerContext(meeting.id, { text: notesText, isReady: notes.isReady }, recipe.scope));
  };

  const handleSendChat = () => {
    const userPrompt = chatInput.trim();
    if (!userPrompt || !chatReady || !notes.isReady || isChatLoading) return;
    setIsAiComposerOpen(true);
    void send(userPrompt, () => loadMeetingAnswerContext(meeting.id, { text: notesText, isReady: notes.isReady }));
    setChatInput('');
  };

  const handleCheckClaim = (claim: string) => {
    if (!chatReady || !notes.isReady || isChatLoading) return;
    setIsAiComposerOpen(true);
    void send(summaryClaimQuestion(claim), () => loadMeetingAnswerContext(meeting.id, { text: notesText, isReady: notes.isReady }));
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
    <div
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-stone-900"
    >
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" aria-label="Meeting document">
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
                {activeView === 'summary' && <DropdownMenuItem disabled={meetingData.isSaving || meetingData.isSummarySaving || !meetingData.isSummaryDirty} onSelect={() => void meetingData.saveAllChanges()}><Save className="mr-2 h-4 w-4" />Save enhanced notes</DropdownMenuItem>}
                <DropdownMenuItem onSelect={meetingOperations.handleOpenMeetingFolder}><FolderOpen className="mr-2 h-4 w-4" />Open recording folder</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <NoteSaveStatus saving={notes.isSaving || meetingData.isSaving || meetingData.isSummarySaving || meetingData.titleSave.status === 'saving'} dirty={meetingData.isSummaryDirty} failed={notes.saveError || meetingData.summarySaveError || meetingData.titleSave.status === 'error'} onRetry={() => { if (meetingData.summarySaveError) void meetingData.saveAllChanges(); else void flushNoteChanges().catch(() => {}); }} />
          </div>
        </div>

        <div className="mt-3 flex min-h-0 flex-col gap-4 pb-8">
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="document-header !border-0 !pb-0">
              <div className="space-y-3">
                <textarea
                  ref={titleRef}
                  value={meetingData.meetingTitle}
                  onChange={(event) => meetingData.handleTitleChange(event.target.value)}
                  placeholder="Untitled meeting"
                  aria-label="Meeting title"
                  rows={1}
                  className="document-title !font-serif !font-normal"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" aria-label="Note view" className="rounded-full shadow-none">
                        {activeView === 'notes' ? <FileText className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {activeView === 'notes' ? 'My notes' : isSummaryGenerating ? 'Enhancing…' : 'Enhanced'}
                        <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuRadioGroup value={activeView} onValueChange={value => setActiveView(value as 'notes' | 'summary')}>
                        <DropdownMenuRadioItem value="notes">My notes</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="summary" disabled={!meetingData.aiSummary && !isSummaryGenerating}>Enhanced notes</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="sm" title={`${transcriptCount} transcript segment${transcriptCount === 1 ? '' : 's'}`} className="rounded-full text-stone-500" onClick={event => openSources('transcript', event.currentTarget)}>Transcript</Button>
                  <span title={formatSavedAt(meeting.updated_at || meeting.created_at)} className="text-xs text-stone-500">{new Date(meeting.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {showEnhanceNotesCta && <EnhanceNotesCta disabled={!notes.isReady} onClick={handleEnhanceNotes} />}
                    <div>
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
                        hasTranscripts={notes.isReady && (meetingData.transcripts.length > 0 || !isNotesEmpty)}
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

            <div className="w-full pt-3 pb-5">
              <div hidden={activeView !== 'summary'}>
                {meetingData.aiSummary ? (
                  <SummaryClaimCheck key={meeting.id}
                    enabled={activeView === 'summary' && chatReady && notes.isReady && !isChatLoading && !isSummaryGenerating}
                    onCheck={handleCheckClaim}>
                    <div className="document-editor [&_.bn-editor]:!px-0">
                      <div className="h-full overflow-y-auto">
                        <BlockNoteSummaryView
                          ref={meetingData.blockNoteSummaryRef}
                          summaryData={meetingData.aiSummary}
                          onSave={meetingData.handleSaveSummary}
                          onSummaryChange={meetingData.handleSummaryChange}
                          onDirtyChange={meetingData.setIsSummaryDirty}
                          autoSave
                          onSavingChange={meetingData.setIsSummarySaving}
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
                  </SummaryClaimCheck>
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
                  <p role="status">{notes.loadError ? 'Could not load written notes.' : 'Loading written notes…'} {notes.loadError && <button type="button" onClick={notes.retryLoad} className="underline">Retry loading notes</button>}</p>
                </div>
              ))}
            </div>
          </section>

          <Sheet open={isSourcesOpen} onOpenChange={setIsSourcesOpen}>
            <SheetContent
              ref={sourcePanelRef}
              onOpenAutoFocus={event => {
                event.preventDefault();
                sourcePanelRef.current?.querySelector<HTMLElement>(sourceView === 'transcript'
                  ? 'input[type="search"]' : '[role="tab"][data-state="active"]')?.focus();
              }}
              onCloseAutoFocus={event => { event.preventDefault(); sourceTriggerRef.current?.focus(); }}
              side="bottom"
              className="h-[78vh] rounded-t-xl border-stone-200 bg-white px-0 pb-0 pt-4"
            >
              <Tabs value={sourceView} onValueChange={value => setSourceView(value as 'notes' | 'transcript')} className="flex h-full flex-col">
                <SheetHeader className="border-b border-stone-200 px-6 pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-4 pr-10">
                    <div>
                      <SheetTitle className="text-stone-900">Meeting sources</SheetTitle>
                      <SheetDescription className="text-stone-600">
                        Current originals. Answer citations keep the excerpts used at the time.
                      </SheetDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {sourceView === 'transcript' && onRefetchTranscripts && (
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
                        disabled={sourceView === 'notes' && (!notes.isReady || !notesText.trim())}
                        onClick={sourceView === 'notes' ? handleCopyNotes : copyOperations.handleCopyTranscript}
                      >
                        <Copy className="h-4 w-4" />
                        {sourceView === 'notes' ? 'Copy notes' : 'Copy Transcript'}
                      </Button>
                    </div>
                  </div>
                  <TabsList aria-label="Meeting source type" className="w-fit">
                    <TabsTrigger value="notes" className="transition-none">Written notes</TabsTrigger>
                    <TabsTrigger value="transcript" className="transition-none">Transcript</TabsTrigger>
                  </TabsList>
                </SheetHeader>

                <TabsContent value="notes" forceMount hidden={sourceView !== 'notes'} className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  <div className="mx-auto max-w-4xl">
                    {!notes.isReady ? <p role="status" className="text-sm text-stone-500">{notes.loadError ? 'Could not load written notes.' : 'Loading written notes…'} {notes.loadError && <button type="button" onClick={notes.retryLoad} className="underline">Retry loading notes</button>}</p>
                      : notesText.trim() ? <p className="whitespace-pre-wrap break-words text-sm leading-7 text-stone-700">{notesText}</p>
                      : <p className="py-8 text-sm text-stone-500">No written notes for this meeting.</p>}
                  </div>
                </TabsContent>
                <TabsContent value="transcript" forceMount hidden={sourceView !== 'transcript'} className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  <div className="mx-auto max-w-4xl space-y-3">
                    <SearchableTranscript meetingId={meeting.id} transcripts={meetingData.transcripts} hasMore={Boolean(hasMore)} autoFocus={false} />

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
                </TabsContent>
              </Tabs>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      </div>
      <Dialog open={isClearChatOpen} onOpenChange={setIsClearChatOpen}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask about this meeting"]')?.focus(); }}>
          <DialogHeader>
            <DialogTitle>Clear this conversation?</DialogTitle>
            <DialogDescription>This removes saved questions and answers for this meeting. Your notes and transcript stay unchanged.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsClearChatOpen(false)}>Keep conversation</Button>
            <Button variant="destructive" onClick={() => { clearMessages(); setIsClearChatOpen(false); }}>Clear conversation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MeetingAssistantDock
        expanded={isComposerExpanded} onExpandedChange={setIsAiComposerOpen}
        messages={messages} loading={isChatLoading} input={chatInput} onInputChange={setChatInput}
        onSend={handleSendChat} onClear={() => setIsClearChatOpen(true)} onStop={stop}
        canSend={chatReady && notes.isReady && Boolean(notesText.trim() || meetingData.transcripts.length)}
        historyStatus={notes.loadError ? 'Could not load written notes. Retry before asking a question.' : historyError || (!notes.isReady ? 'Loading written notes…' : !chatReady ? 'Loading conversation…' : undefined)}
        onRetryHistory={notes.loadError ? notes.retryLoad : historyError ? retryHistory : undefined}
        onReviewSources={trigger => openSources('notes', trigger)}
        recipes={RECIPES.map(recipe => ({ label: recipe.label, onSelect: () => handleRecipe(recipe) }))}
      />
    </div>
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
