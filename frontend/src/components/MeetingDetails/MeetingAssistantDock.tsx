'use client';

import { ArrowDown, ArrowUp, ChevronUp, Loader2, MessageCircle, Sparkles, X } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { AssistantMessage } from '@/components/AssistantMessage';
import type { ChatMessage } from '@/hooks/useLiveMeetingChat';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface Props {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  messages: ChatMessage[];
  loading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
  onStop: () => void;
  canSend: boolean;
  recipes: { label: string; onSelect: () => void }[];
  historyStatus?: string;
  onRetryHistory?: () => void;
  onReviewSources?: (trigger: HTMLButtonElement) => void;
  title?: string;
  inputLabel?: string;
  emptyMessage?: string;
  loadingLabel?: string;
  workspace?: boolean;
  readOnly?: boolean;
  label?: string;
  /** Sibling control to the left of the Ask bar. Live Stop and post-stop Resume share this slot so Ask does not shift. */
  leadingAction?: ReactNode;
}

/** Keep meeting questions reachable while the document scrolls independently. */
export function MeetingAssistantDock(props: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const wasExpanded = useRef(false);
  const ignoreFocusExpand = useRef(false);
  const [showLatest, setShowLatest] = useState(false);
  const jumpToLatest = () => {
    followLatest.current = true;
    setShowLatest(false);
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  };
  useLayoutEffect(() => {
    if (props.messages.length === 0 || (props.expanded && (!wasExpanded.current || followLatest.current))) jumpToLatest();
    wasExpanded.current = props.expanded;
  }, [props.messages, props.expanded, props.loading]);
  useLayoutEffect(() => {
    if (props.expanded) inputRef.current?.focus({ preventScroll: true });
  }, [props.expanded]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const fit = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    let width = -1;
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth === undefined || nextWidth === width) return;
      width = nextWidth;
      fit();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [props.input]);
  const collapse = () => {
    ignoreFocusExpand.current = true;
    props.onExpandedChange(false);
    inputRef.current?.focus();
    queueMicrotask(() => { ignoreFocusExpand.current = false; });
  };
  const expand = () => {
    if (ignoreFocusExpand.current || props.expanded) return;
    props.onExpandedChange(true);
  };
  const submit = () => {
    if (!props.canSend || props.loading || !props.input.trim()) return;
    followLatest.current = true;
    props.onSend();
  };
  return (
    <aside onKeyDown={event => { if (event.key === 'Escape' && props.expanded) { event.preventDefault(); collapse(); } }} aria-label={props.label || 'Meeting assistant'} className={`${props.workspace && props.expanded ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'} bg-background px-4 pb-5 pt-2 md:px-8`}>
      <div className={`mx-auto flex w-full max-w-3xl gap-4 ${props.workspace && props.expanded ? 'min-h-0 flex-1' : ''}`}>
        {props.leadingAction ? <div className="flex h-[52px] w-[8.25rem] shrink-0 items-stretch self-end [&>*]:h-full [&>*]:w-full">{props.leadingAction}</div> : null}
        <div className={`min-w-0 flex-1 border border-stone-200 bg-white shadow-sm ${props.workspace && props.expanded ? 'flex min-h-0 flex-1 flex-col' : ''} ${props.expanded ? 'rounded-2xl' : 'rounded-[28px]'}`}>
        {props.historyStatus && <p role="status" className="px-5 pt-3 text-xs text-stone-600">{props.historyStatus} {props.onRetryHistory && <button type="button" onClick={props.onRetryHistory} className="underline">Retry</button>}</p>}
        {props.expanded && (
          <div className={`relative border-b border-stone-100 px-4 pt-3 ${props.workspace ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
            <div className="mb-3 flex items-center gap-2">
              <MessageCircle aria-hidden="true" className="h-3.5 w-3.5 text-stone-400" />
              <h2 className="text-xs font-medium text-stone-600">{props.title || 'Chat with this meeting'}</h2>
              <div className="ml-auto flex shrink-0 items-center">
                {props.onReviewSources && <button type="button" onClick={event => props.onReviewSources?.(event.currentTarget)}
                  className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-100">Review sources</button>}
                {props.messages.length > 0 && !props.readOnly && <button type="button" onClick={() => { props.onClear(); inputRef.current?.focus(); }}
                  className="rounded-md px-2 py-1 text-xs text-stone-500 hover:bg-stone-100">Clear</button>}
              </div>
              <button type="button" aria-label="Collapse assistant" onClick={collapse}
                className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="h-4 w-4" /></button>
            </div>
            <div ref={messagesRef} role="region" aria-label="Conversation" tabIndex={0}
              onScroll={event => {
                const element = event.currentTarget;
                followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
                setShowLatest(!followLatest.current);
              }} className={`${props.workspace ? 'min-h-0 flex-1' : 'max-h-[36vh]'} space-y-4 overflow-y-scroll overscroll-contain pb-4 text-sm leading-6 [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-1 focus-visible:outline-stone-300`}>
              {props.messages.length === 0 && !props.loading && <p className="py-3 text-sm text-stone-500">{props.emptyMessage || 'Ask a question or choose a recipe. Answers use this meeting’s notes and transcript.'}</p>}
              {props.messages.map((message, index) => <div key={index}
                className={message.role === 'user' ? 'ml-8 rounded-xl bg-stone-100 px-3 py-2 whitespace-pre-wrap' : 'px-1 text-stone-700'}>
                {message.role === 'assistant' ? <AssistantMessage content={message.content} sources={message.sources} notice={message.notice} coverage={message.coverage} copyable={!props.loading || index < props.messages.length - 1} /> : message.content}
                {message.role === 'assistant' && message.content.startsWith('Error:') && props.messages[index - 1]?.role === 'user' && <button type="button" disabled={props.loading || props.readOnly} className="mt-1 rounded-md px-1.5 py-1 text-xs text-stone-600 underline disabled:opacity-40" onClick={() => { props.onInputChange(props.messages[index - 1].content); inputRef.current?.focus(); }}>Edit question</button>}
              </div>)}
              {props.loading && <p className="flex items-center gap-2 text-stone-500"><Loader2 className="h-4 w-4 animate-spin" />{props.loadingLabel || 'Writing an answer…'}</p>}
            </div>
            {showLatest && <button type="button" onClick={() => { jumpToLatest(); messagesRef.current?.focus(); }} className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 shadow-sm"><ArrowDown className="h-3 w-3" />Jump to latest</button>}
          </div>
        )}
        {props.expanded && props.messages.length === 0 && !props.loading && props.recipes.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-stone-100 px-4 py-2">
            {props.recipes.map(recipe => (
              <button
                key={recipe.label}
                type="button"
                disabled={props.loading || !props.canSend}
                onClick={() => { followLatest.current = true; recipe.onSelect(); }}
                className="rounded-full border border-stone-200 px-3 py-1.5 text-xs leading-[18px] text-stone-600 hover:bg-stone-100 disabled:opacity-40"
              >
                {recipe.label}
              </button>
            ))}
          </div>
        )}
        <form className="flex shrink-0 items-end gap-1.5 p-2" onSubmit={event => { event.preventDefault(); submit(); }}>
          {props.recipes.length > 0 && <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" aria-label="Recipes" disabled={props.loading || !props.canSend} className="shrink-0 rounded-full p-2.5 text-stone-500 hover:bg-stone-100 disabled:opacity-40"><Sparkles className="h-4 w-4" /></button></DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              {props.recipes.map(recipe => <DropdownMenuItem key={recipe.label} onSelect={() => { followLatest.current = true; recipe.onSelect(); }}>{recipe.label}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>}
          <textarea ref={inputRef} rows={1} disabled={props.readOnly} aria-label={props.inputLabel || 'Ask about this meeting'} aria-describedby="meeting-composer-help" value={props.input} onChange={event => props.onInputChange(event.target.value)}
            onFocus={expand}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); submit(); }
            }} placeholder={`${props.inputLabel || 'Ask about this meeting'}…`} className="min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 outline-none focus-visible:ring-1 focus-visible:ring-stone-400 rounded-md" />
          <span id="meeting-composer-help" className="sr-only">Enter to send. Shift+Enter for a new line.</span>
          {!props.expanded && !props.input && props.messages.length === 0 && props.recipes[0] && <button type="button" disabled={props.loading || !props.canSend} onClick={props.recipes[0].onSelect}
            className="mb-0.5 hidden shrink-0 rounded-full border border-stone-200 px-3 py-2 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-40 sm:block">{props.recipes[0].label}</button>}
          {!props.expanded && props.messages.length > 0 && <button type="button" aria-label="Show conversation" onClick={() => { props.onExpandedChange(true); inputRef.current?.focus(); }} className="rounded-full p-2.5 text-stone-500 hover:bg-stone-100"><ChevronUp className="h-4 w-4" /></button>}
          {props.loading ? <button type="button" onClick={props.onStop} aria-label="Stop answer"
            className="rounded-full bg-stone-900 px-3 py-2.5 text-sm text-white">Stop</button> :
          <button type="submit" aria-label="Send question" disabled={!props.input.trim() || !props.canSend}
            className="rounded-full bg-stone-900 p-2.5 text-white disabled:opacity-20"><ArrowUp className="h-4 w-4" /></button>}
        </form>
        </div>
      </div>
      <p role="status" className="sr-only">{props.loading ? props.loadingLabel || 'Writing an answer' : props.messages.at(-1)?.role === 'assistant' ? props.messages.at(-1)?.notice || (props.messages.at(-1)?.content.startsWith('Error:') ? 'Could not answer. Edit the question to try again.' : 'Answer ready') : ''}</p>
    </aside>
  );
}
