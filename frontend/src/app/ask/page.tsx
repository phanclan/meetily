'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, ArrowLeft, History, MessageCircle, Plus } from 'lucide-react';
import { MeetingAssistantDock } from '@/components/MeetingDetails/MeetingAssistantDock';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLibraryChat } from '@/hooks/useLibraryChat';
import { loadLibraryAnswerContext, type LibraryPeriod } from '@/lib/libraryAnswerContext';
import { meetnolaInvoke } from '@/meetnola/ipc';

interface Conversation { id: string; title: string; updatedAt: string }
const chatPath = (id: string) => `/ask?chat=${encodeURIComponent(id)}`;
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default function AskNotesPage() {
  return <Suspense fallback={<p className="p-8 text-sm text-stone-500">Loading conversations…</p>}><AskNotesRoute /></Suspense>;
}

function AskNotesRoute() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('chat');
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (id) return;
    let current = true;
    setError(null);
    void meetnolaInvoke<Conversation[]>('list_library_chats', { archived: false, offset: 0 }).then(items => {
      if (current) router.replace(chatPath(items[0]?.id || crypto.randomUUID()));
    }).catch(error => { if (current) setError(String(error)); });
    return () => { current = false; };
  }, [id, router, retry]);
  if (id && validId(id)) return <AskWorkspace key={id} chatId={id} />;
  return <div className="p-8 text-sm text-stone-600"><p role="status">{id ? 'This conversation link is invalid.' : error || 'Loading conversations…'}</p>
    {error && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry</Button>}
    {(id || error) && <Button variant="outline" onClick={() => router.replace(chatPath(crypto.randomUUID()))}>New chat</Button>}
  </div>;
}

function AskWorkspace({ chatId }: { chatId: string }) {
  const router = useRouter();
  const chat = useLibraryChat(chatId);
  const { draft: input, period, archived } = chat.settings;
  const setInput = chat.setInput;
  const [expanded, setExpanded] = useState(false);
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
  useEffect(() => { if (chat.ready && chat.messages.length) setExpanded(true); }, [chat.ready]);
  useEffect(() => () => { request.current += 1; listRequest.current += 1; }, []);
  const loadHistory = async (archivedFilter: boolean, append = false) => {
    const token = ++listRequest.current;
    setListLoading(true); setListError(null); setShowArchived(archivedFilter);
    if (!append) setConversations([]);
    try {
      await chat.flush();
      const result = await meetnolaInvoke<Conversation[]>('list_library_chats', { archived: archivedFilter, offset: append ? conversations.length : 0 });
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
      await meetnolaInvoke('set_library_chat_archived', { chatId, archived: !archived });
      if (archived) chat.reloadSettings();
      else router.replace(chatPath(crypto.randomUUID()));
    } catch (error) { setActionError(String(error)); }
    finally { setArchiving(false); }
  };
  const send = () => {
    if (!input.trim() || chat.isLoading || !chat.ready || archived) return;
    const question = input.trim();
    const id = ++request.current;
    setInput('');
    setExpanded(true);
    setSearching(true);
    void chat.send(question, async () => {
      try { return await loadLibraryAnswerContext(question, chat.messages, period); }
      finally { if (request.current === id) setSearching(false); }
    });
  };
  const stop = () => { request.current += 1; setSearching(false); chat.stop(); };
  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background" aria-label="Ask your notes">
    <header className="mx-auto w-full max-w-3xl shrink-0 px-5 pb-3 pt-5 md:px-8">
      <button type="button" onClick={() => router.push('/')} className="mb-4 flex items-center gap-2 rounded-md text-xs text-stone-500 hover:text-stone-900"><ArrowLeft className="h-3.5 w-3.5" />Your notes</button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl tracking-tight text-stone-900">Ask your notes</h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => { setShowHistory(true); void loadHistory(false); }} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-stone-600 hover:bg-stone-100"><History className="h-3.5 w-3.5" />Conversations</button>
          <button type="button" onClick={() => router.push(chatPath(crypto.randomUUID()))} className="flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-2 text-xs text-stone-700 hover:bg-stone-100"><Plus className="h-3.5 w-3.5" />New chat</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-stone-500">
        <label htmlFor="library-period">Meetings from</label>
        <select id="library-period" value={period} disabled={chat.isLoading || !chat.ready || archived} onChange={event => chat.setPeriod(event.target.value as LibraryPeriod)} className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-stone-700 focus-visible:outline-stone-400">
          <option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
        </select>
        <span>{archived ? 'Archived · restore to continue' : chat.saving ? 'Saving draft…' : 'Conversations save on this Mac'}</span>
        {chat.ready && (chat.messages.length > 0 || input || archived) && <button type="button" disabled={archiving || chat.isLoading} onClick={() => void changeArchive()} className="ml-auto flex items-center gap-1 rounded px-2 py-1 hover:bg-stone-100 disabled:opacity-40"><Archive className="h-3 w-3" />{archived ? 'Restore conversation' : 'Archive conversation'}</button>}
      </div>
      {actionError && <p role="alert" className="mt-2 text-xs text-red-700">{actionError}</p>}
      {chat.settingsError && <p role="alert" className="mt-2 text-xs text-red-700">{chat.settingsError} <button type="button" onClick={chat.retrySettings} className="underline">Retry draft save or load</button></p>}
    </header>
    {!expanded && <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-8 py-5">
      <MessageCircle className="mb-3 h-6 w-6 text-stone-400" />
      <h2 className="font-serif text-2xl text-stone-800">Connect the dots across meetings</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-stone-500">Ask about a project, a decision, or someone’s next steps. Answers use matching words in your original notes and transcripts, with links to the meetings.</p>
      <p className="mt-3 max-w-lg text-xs leading-5 text-stone-500">Include a topic or name. Up to 16 excerpts inform each answer, so results may omit relevant details.</p>
    </div>}
    <MeetingAssistantDock workspace expanded={expanded} onExpandedChange={setExpanded} messages={chat.messages} loading={chat.isLoading}
      input={input} onInputChange={setInput} onSend={send} onStop={stop} onClear={() => setConfirmClear(true)} canSend={chat.ready && !archived} readOnly={!chat.ready || archived} recipes={[]}
      historyStatus={chat.historyError || (!chat.ready ? 'Loading conversation…' : undefined)} onRetryHistory={chat.historyError ? chat.retryHistory : undefined}
      title="Chat with your notes" inputLabel="Ask across meetings" loadingLabel={searching ? 'Finding matching notes…' : 'Writing an answer…'}
      emptyMessage="Include a topic or name from your notes to find relevant meetings." />
    <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask across meetings"]')?.focus(); }}>
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
        <div className="max-h-[45vh] min-w-0 overflow-y-auto">
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
  </main>;
}
