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
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Summary } from '@/types';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { MeetingAssistantDock } from '@/components/MeetingDetails/MeetingAssistantDock';
import { FindInNote } from '@/components/MeetingDetails/FindInNote';
import { SummaryClaimCheck } from '@/components/MeetingDetails/SummaryClaimCheck';
import { NotesCoverageDialog } from '@/components/MeetingDetails/NotesCoverageDialog';
import { MarkdownExportDialog } from '@/components/MeetingDetails/MarkdownExportDialog';
import { summaryClaimQuestion } from '@/lib/summaryClaim';
import { SearchableTranscript } from '@/components/MeetingDetails/SearchableTranscript';
import { SearchResultSource } from '@/components/MeetingDetails/SearchResultSource';
import type { SavedSearchTarget } from '@/hooks/useSavedSearchMatch';
import { MeetingFoldersDialog } from '@/components/NoteFolderControls';
import { PreviousSummaryDialog } from '@/components/MeetingDetails/PreviousSummaryDialog';
import { createWriteQueue } from '@/lib/pendingWrites';
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
import { afterwordInvoke } from '@/afterword/ipc';

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
  backHref = '/',
  backLabel = 'Home',
  preferWrittenNotes = false,
  initialSearchMatch,
  summaryData,
  initialSummaryStatus,
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
  backHref?: string;
  backLabel?: string;
  preferWrittenNotes?: boolean;
  initialSearchMatch?: SavedSearchTarget;
  summaryData: Summary | null;
  initialSummaryStatus?: string;
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
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const findContentRef = useRef<HTMLDivElement | null>(null);
  const actionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isMarkdownExportOpen, setIsMarkdownExportOpen] = useState(false);
  const findFromMenuRef = useRef(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sourcePanelRef = useRef<HTMLDivElement | null>(null);
  const fullSourceFocusRef = useRef(false);
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const notes = useMeetingNotes(meeting.id);
  const notesText = useMemo(() => blocksToPlainText(notes.blocks), [notes.blocks]);
  const [activeView, setActiveView] = useState<'notes' | 'summary'>('notes');
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [sourceView, setSourceView] = useState<'notes' | 'transcript'>('transcript');
  const [searchMatch, setSearchMatch] = useState<SavedSearchTarget | null>(null);
  const initialMatchKind = initialSearchMatch?.kind;
  const initialMatchSourceId = initialSearchMatch?.sourceId;
  const initialMatchQuery = initialSearchMatch?.query;
  useEffect(() => {
    if (!fullSourceFocusRef.current || searchMatch) return;
    fullSourceFocusRef.current = false;
    sourcePanelRef.current?.querySelector<HTMLElement>(sourceView === 'transcript'
      ? 'input[type="search"]' : '[role="tab"][data-state="active"]')?.focus();
  }, [searchMatch, sourceView]);
  useEffect(() => {
    if (!initialMatchKind || !initialMatchSourceId || !initialMatchQuery) {
      setSearchMatch(null);
      setIsSourcesOpen(false);
      return;
    }
    setSearchMatch({ kind: initialMatchKind, sourceId: initialMatchSourceId, query: initialMatchQuery });
    setSourceView(initialMatchKind);
    setIsSourcesOpen(true);
  }, [initialMatchKind, initialMatchSourceId, initialMatchQuery]);
  const openSources = (view: 'notes' | 'transcript', trigger: HTMLButtonElement) => {
    sourceTriggerRef.current = trigger;
    setSearchMatch(null);
    setSourceView(view);
    setIsSourcesOpen(true);
  };
  const [isAiComposerOpen, setIsAiComposerOpen] = useState(false);
  const [isClearChatOpen, setIsClearChatOpen] = useState(false);
  const [isPreviousSummaryOpen, setIsPreviousSummaryOpen] = useState(false);
  const [isNotesCoverageOpen, setIsNotesCoverageOpen] = useState(false);
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
    initialSummaryStatus,
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
    setActiveView(summaryData && !preferWrittenNotes ? 'summary' : 'notes');
  }, [meeting.id, summaryData, preferWrittenNotes]);

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

  const handleGoBack = async () => {
    try {
      await flushNoteChanges();
      if (meetingData.blockNoteSummaryRef.current?.isDirty && !await meetingData.saveAllChanges()) return;
      router.push(backHref);
    } catch {
      toast.error('Changes are not saved. Retry before leaving.');
    }
  };

  const handleMoveToTrash = async () => {
    try {
      await flushNoteChanges();
      await afterwordInvoke('trash_meeting', { meetingId: meeting.id });
      toast.success('Note moved to Trash');
      router.push(backHref);
    } catch (error) {
      toast.error('Could not move note to Trash', {
        description: error instanceof Error ? error.message : String(error),
      });
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
      <FindInNote key={`find:${meeting.id}`} open={isFindOpen} onOpenChange={setIsFindOpen} contentRef={findContentRef} returnFocusRef={actionsButtonRef} scopeKey={`${meeting.id}:${activeView}`} />
      <MarkdownExportDialog key={`export:${meeting.id}`} meetingId={meeting.id} open={isMarkdownExportOpen} onOpenChange={setIsMarkdownExportOpen}
        beforeExport={async () => {
          if (!notes.isReady || isSummaryGenerating) throw new Error('Wait for your notes and enhancement to finish loading.');
          await flushNoteChanges();
          await meetingData.blockNoteSummaryRef.current?.saveSummary();
          await createWriteQueue(`summary:${meeting.id}`).flush();
        }} />
      <NotesCoverageDialog key={`coverage:${meeting.id}`} meetingId={meeting.id} open={isNotesCoverageOpen} onOpenChange={setIsNotesCoverageOpen}
        readSnapshot={async () => {
          if (!notes.isReady || isSummaryGenerating) throw new Error('Wait for your notes and enhancement to finish loading.');
          const draft = await meetingData.blockNoteSummaryRef.current?.getMarkdown();
          if (!draft?.trim()) throw new Error('The enhanced document is not ready. Close this review and try again.');
          return { notes: notesText, draft };
        }} />
      <div data-note-scroll className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" aria-label="Meeting document">
      <div className="document-shell !min-h-0 !max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            ref={backButtonRef}
            onClick={() => void handleGoBack()}
            className="document-back"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </button>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" ref={actionsButtonRef} aria-label="Meeting actions" data-meeting-actions-id={meeting.id}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onCloseAutoFocus={event => {
                if (!findFromMenuRef.current) return;
                findFromMenuRef.current = false;
                event.preventDefault();
                requestAnimationFrame(() => {
                  const input = document.querySelector<HTMLInputElement>('input[aria-label="Find in note"]');
                  input?.focus();
                  input?.select();
                });
              }}>
                <DropdownMenuItem onSelect={() => {
                  findFromMenuRef.current = true;
                  setIsFindOpen(true);
                }}><Search className="mr-2 h-4 w-4" />Find in note<span className="ml-auto pl-6 text-xs text-stone-400">⌘F</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => activeView === 'notes' ? handleCopyNotes() : copyOperations.handleCopySummary()}><Copy className="mr-2 h-4 w-4" />{activeView === 'notes' ? 'Copy meeting notes' : 'Copy enhanced notes'}</DropdownMenuItem>
                {activeView === 'summary' && <DropdownMenuItem disabled={meetingData.isSaving || meetingData.isSummarySaving || !meetingData.isSummaryDirty} onSelect={() => void meetingData.saveAllChanges()}><Save className="mr-2 h-4 w-4" />Save enhanced notes</DropdownMenuItem>}
                <DropdownMenuItem onSelect={meetingOperations.handleOpenMeetingFolder}><FolderOpen className="mr-2 h-4 w-4" />Open recording folder</DropdownMenuItem>
                <DropdownMenuItem disabled={!notes.isReady || isSummaryGenerating} onSelect={() => setIsMarkdownExportOpen(true)}>Export Markdown</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsFolderDialogOpen(true)}><FolderOpen className="mr-2 h-4 w-4" />Organize note</DropdownMenuItem>
                <DropdownMenuItem disabled={isSummaryGenerating} onSelect={() => setIsPreviousSummaryOpen(true)}>Previous enhancement</DropdownMenuItem>
                <DropdownMenuItem disabled={!notes.isReady || isNotesEmpty || !meetingData.aiSummary || isSummaryGenerating} onSelect={() => setIsNotesCoverageOpen(true)}>Review written-note coverage</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleMoveToTrash()} className="text-red-600 focus:bg-red-50 focus:text-red-700"><Trash2 className="mr-2 h-4 w-4" />Move to Trash</DropdownMenuItem>
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

            <div ref={findContentRef} className="w-full pt-3 pb-5">
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
                sourcePanelRef.current?.querySelector<HTMLElement>(searchMatch ? '[data-search-match-heading]' : sourceView === 'transcript'
                  ? 'input[type="search"]' : '[role="tab"][data-state="active"]')?.focus();
              }}
              onCloseAutoFocus={event => { event.preventDefault(); (sourceTriggerRef.current ?? backButtonRef.current)?.focus(); }}
              side="bottom"
              className="h-[78vh] rounded-t-xl border-stone-200 bg-white px-0 pb-0 pt-4"
            >
              <Tabs value={sourceView} onValueChange={value => { setSourceView(value as 'notes' | 'transcript'); setSearchMatch(null); }} className="flex h-full flex-col">
                <SheetHeader className="border-b border-stone-200 px-6 pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-4 pr-10">
                    <div>
                      <SheetTitle className="text-stone-900">Meeting sources</SheetTitle>
                      <SheetDescription className="text-stone-600">
                        Current originals. Answer citations keep the excerpts used at the time.
                      </SheetDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {sourceView === 'transcript' && !searchMatch && onRefetchTranscripts && (
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

                {searchMatch ? <TabsContent value={searchMatch.kind} className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  <SearchResultSource meetingId={meeting.id} target={searchMatch} onShowAll={() => { fullSourceFocusRef.current = true; setSearchMatch(null); }} />
                </TabsContent> : <>
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
                </>}
              </Tabs>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      </div>
      <MeetingFoldersDialog meetingId={meeting.id} open={isFolderDialogOpen} onOpenChange={setIsFolderDialogOpen} />
      <PreviousSummaryDialog key={meeting.id} meetingId={meeting.id} open={isPreviousSummaryOpen} onOpenChange={setIsPreviousSummaryOpen}
        beforeRead={async () => {
          await meetingData.blockNoteSummaryRef.current?.saveSummary();
          await createWriteQueue(`summary:${meeting.id}`).flush();
        }}
        onRestored={result => { meetingData.setAiSummary(result); setActiveView('summary'); toast.success('Previous enhancement restored'); }} />
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
