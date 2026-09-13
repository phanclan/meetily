'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, History, Plus } from 'lucide-react';
import { MeetingAssistantDock } from '@/components/MeetingDetails/MeetingAssistantDock';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLibraryChat } from '@/hooks/useLibraryChat';
import { loadLibraryAnswerContext, type LibraryPeriod, type LibrarySourceScope } from '@/lib/libraryAnswerContext';
import { LIBRARY_RECIPES } from '@/lib/libraryRecipes';
import { validLibraryChatId } from '@/lib/askRoute';
import { afterwordInvoke } from '@/afterword/ipc';

interface Conversation { id: string; title: string; updatedAt: string }

interface AskNotesPanelProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  chatPath: (id: string) => string;
  chatId?: string | null;
}

export function AskNotesPanel({ expanded, onExpandedChange, chatPath, chatId: requestedId }: AskNotesPanelProps) {
  const router = useRouter();
  const requested = requestedId && validLibraryChatId(requestedId) ? requestedId : null;
  const invalidRequested = Boolean(requestedId) && !requested;
  const [resolvedId, setResolvedId] = useState<string | null>(requested);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const chatPathRef = useRef(chatPath);
  chatPathRef.current = chatPath;
  useEffect(() => {
    if (requested) {
      setResolvedId(requested);
      return;
    }
    if (invalidRequested) {
      setResolvedId(null);
      return;
    }
    let current = true;
    setError(null);
    void afterwordInvoke<Conversation[]>('list_library_chats', { archived: false, offset: 0 }).then(items => {
      if (!current) return;
      const next = items[0]?.id || crypto.randomUUID();
      setResolvedId(next);
    }).catch(error => { if (current) setError(String(error)); });
    return () => { current = false; };
  }, [requested, invalidRequested, retry]);
  useEffect(() => {
    if (!expanded || !resolvedId || requested === resolvedId) return;
    router.replace(chatPathRef.current(resolvedId));
  }, [expanded, resolvedId, requested, router]);
  if (resolvedId) return <AskWorkspace key={resolvedId} chatId={resolvedId} expanded={expanded} onExpandedChange={onExpandedChange} chatPath={chatPath} />;
  if (invalidRequested || error) {
    return (
      <div className="px-5 py-4 text-sm text-stone-600 md:px-8">
        <p role="status">{invalidRequested ? 'This conversation link is invalid.' : error}</p>
        {error && <Button variant="outline" className="mt-2" onClick={() => setRetry(value => value + 1)}>Retry</Button>}
        <Button variant="outline" className="mt-2 ml-2" onClick={() => router.replace(chatPath(crypto.randomUUID()))}>New chat</Button>
      </div>
    );
  }
  return (
    <section className="shrink-0" aria-label="Ask your notes">
      <MeetingAssistantDock
        workspace={false}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        messages={[]}
        loading={false}
        input=""
        onInputChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        onClear={() => {}}
        canSend={false}
        readOnly
        recipes={LIBRARY_RECIPES.map(recipe => ({ label: recipe.label, onSelect: () => {} }))}
        label="Ask your notes"
        title="Ask your notes"
        inputLabel="Ask anything"
        historyStatus="Loading conversation…"
      />
    </section>
  );
}

function AskWorkspace({
  chatId,
  expanded,
  onExpandedChange,
  chatPath,
}: {
  chatId: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  chatPath: (id: string) => string;
}) {
  const router = useRouter();
  const chat = useLibraryChat(chatId);
  const { draft: input, period, sourceScope, archived } = chat.settings;
  const setInput = chat.setInput;
  const [searching, setSearching] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const listRequest = useRef(0);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; listRequest.current += 1; }, []);
  const loadHistory = async (archivedFilter: boolean, append = false) => {
    const token = ++listRequest.current;
    setListLoading(true); setListError(null); setShowArchived(archivedFilter);
    if (!append) setConversations([]);
    try {
      await chat.flush();
      const result = await afterwordInvoke<Conversation[]>('list_library_chats', { archived: archivedFilter, offset: append ? conversations.length : 0 });
      if (token !== listRequest.current) return;
      setConversations(previous => append ? [...previous, ...result] : result);
      setMore(result.length === 30);
    } catch (error) { if (token === listRequest.current) setListError(String(error)); }
    finally { if (token === listRequest.current) setListLoading(false); }
  };
  const changeArchive = async () => {
    setArchiving(true); setActionError(null);
    try {
      await chat.flush();
      await afterwordInvoke('set_library_chat_archived', { chatId, archived: !archived });
      if (archived) chat.reloadSettings();
      else router.replace(chatPath(crypto.randomUUID()));
    } catch (error) { setActionError(String(error)); }
    finally { setArchiving(false); }
  };
  const sendQuestion = (question: string, scope: LibrarySourceScope = sourceScope) => {
    if (!question.trim() || chat.isLoading || !chat.ready || archived) return;
    const id = ++request.current;
    if (scope !== sourceScope) chat.setSourceScope(scope);
    setInput('');
    setExpanded(true);
    setSearching(true);
    void chat.send(question, async () => {
      try { return await loadLibraryAnswerContext(question, chat.messages, period, scope); }
      finally { if (request.current === id) setSearching(false); }
    });
  };
  const send = () => sendQuestion(input.trim());
  const stop = () => { request.current += 1; setSearching(false); chat.stop(); };
  const setExpanded = (open: boolean) => {
    if (open) router.replace(chatPath(chatId));
    else onExpandedChange(false);
  };
  const recipes = LIBRARY_RECIPES.map(recipe => ({
    label: recipe.label,
    onSelect: () => sendQuestion(recipe.prompt, recipe.sourceScope),
  }));
  return (
    <section className="shrink-0" aria-label="Ask your notes">
      {expanded && (
        <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-1 text-xs text-stone-500 md:px-8">
          <button type="button" onClick={() => { setShowHistory(true); void loadHistory(false); }} className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-stone-600 hover:bg-stone-100">
            <History className="h-3.5 w-3.5" />Conversations
          </button>
          <button type="button" onClick={() => router.push(chatPath(crypto.randomUUID()))} className="flex items-center gap-1.5 rounded-full border border-stone-200 px-2 py-1.5 text-stone-700 hover:bg-stone-100">
            <Plus className="h-3.5 w-3.5" />New chat
          </button>
          <label htmlFor="library-scope" className="ml-auto">Sources</label>
          <select id="library-scope" value={sourceScope} disabled={chat.isLoading || !chat.ready || archived} onChange={event => chat.setSourceScope(event.target.value as LibrarySourceScope)} className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-stone-700 focus-visible:outline-stone-400">
            <option value="keywords">Keyword matches</option><option value="recent">Recent meetings</option>
          </select>
          <label htmlFor="library-period">Meetings from</label>
          <select id="library-period" value={period} disabled={chat.isLoading || !chat.ready || archived} onChange={event => chat.setPeriod(event.target.value as LibraryPeriod)} className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-stone-700 focus-visible:outline-stone-400">
            <option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </select>
          <span>{archived ? 'Archived · restore to continue' : chat.saving ? 'Saving draft…' : 'Saved on this Mac'}</span>
          {chat.ready && (chat.messages.length > 0 || input || archived) && <button type="button" disabled={archiving || chat.isLoading} onClick={() => void changeArchive()} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-stone-100 disabled:opacity-40"><Archive className="h-3 w-3" />{archived ? 'Restore' : 'Archive'}</button>}
          {actionError && <p role="alert" className="basis-full text-red-700">{actionError}</p>}
          {chat.settingsError && <p role="alert" className="basis-full text-red-700">{chat.settingsError} <button type="button" onClick={chat.retrySettings} className="underline">Retry draft save or load</button></p>}
        </div>
      )}
      <MeetingAssistantDock
        workspace={false}
        expanded={expanded}
        onExpandedChange={setExpanded}
        messages={chat.messages}
        loading={chat.isLoading}
        input={input}
        onInputChange={setInput}
        onSend={send}
        onStop={stop}
        onClear={() => setConfirmClear(true)}
        canSend={chat.ready && !archived}
        readOnly={!chat.ready || archived}
        recipes={recipes}
        label="Ask your notes"
        historyStatus={chat.historyError || (!chat.ready ? 'Loading conversation…' : undefined)}
        onRetryHistory={chat.historyError ? chat.retryHistory : undefined}
        title="Ask your notes"
        inputLabel="Ask anything"
        loadingLabel={searching ? (sourceScope === 'recent' ? 'Reading recent meetings…' : 'Finding matching notes…') : 'Writing an answer…'}
        emptyMessage={sourceScope === 'recent' ? 'Try a recipe, or ask what follow-ups were agreed in recent meetings.' : 'Include a topic or name from your notes, or choose a recipe to review recent meetings.'}
      />
      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask anything"]')?.focus(); }}>
          <DialogTitle>Clear this conversation?</DialogTitle>
          <DialogDescription>This removes the questions and answers in this chat. Your meeting notes and transcripts stay saved.</DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>Keep conversation</Button>
            <Button variant="destructive" onClick={() => { request.current += 1; chat.clearMessages(); setSearching(false); setConfirmClear(false); }}>Clear conversation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent>
          <DialogTitle>Conversations</DialogTitle>
          <DialogDescription>Reopen saved questions and their original citations.</DialogDescription>
          <div className="flex gap-2 text-sm">
            <button type="button" aria-pressed={!showArchived} onClick={() => void loadHistory(false)} className="rounded-full px-3 py-1.5 aria-pressed:bg-stone-100">Recent</button>
            <button type="button" aria-pressed={showArchived} onClick={() => void loadHistory(true)} className="rounded-full px-3 py-1.5 aria-pressed:bg-stone-100">Archived</button>
          </div>
          <div className="max-h-[45vh] min-w-0 overflow-y-scroll [scrollbar-gutter:stable]">
            {conversations.map(item => <button key={item.id} type="button" aria-current={item.id === chatId ? 'page' : undefined} onClick={() => { setShowHistory(false); router.push(chatPath(item.id)); }} className="flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left hover:bg-stone-100 aria-[current=page]:bg-stone-100">
              <span className="w-full truncate text-sm font-medium">{item.title}</span><span className="text-xs text-stone-500">{new Date(item.updatedAt).toLocaleDateString()}</span>
            </button>)}
            {!listLoading && !listError && !conversations.length && <p className="px-3 py-5 text-sm text-stone-500">{showArchived ? 'No archived conversations' : 'No saved conversations yet'}</p>}
            {listLoading && <p role="status" className="px-3 py-3 text-sm text-stone-500">Loading…</p>}
            {listError && <p role="alert" className="px-3 py-3 text-sm text-red-700">{listError} <button type="button" onClick={() => void loadHistory(showArchived)} className="underline">Retry</button></p>}
            {more && !listLoading && !listError && <button type="button" onClick={() => void loadHistory(showArchived, true)} className="px-3 py-2 text-sm underline">Load more conversations</button>}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
