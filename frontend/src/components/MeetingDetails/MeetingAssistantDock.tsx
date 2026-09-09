'use client';

import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { useRef } from 'react';
import { AssistantMessage } from '@/components/AssistantMessage';
import type { ChatMessage } from '@/hooks/useLiveMeetingChat';

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
}

/** Keep meeting questions reachable while the document scrolls independently. */
export function MeetingAssistantDock(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const collapse = () => { props.onExpandedChange(false); inputRef.current?.focus(); };
  return (
    <aside onKeyDown={event => { if (event.key === 'Escape' && props.expanded) { event.preventDefault(); collapse(); } }} aria-label="Meeting assistant" className="shrink-0 bg-background px-4 pb-5 pt-2 md:px-8">
      <div className="mx-auto max-w-3xl rounded-xl border border-stone-200 bg-white shadow-sm">
        {props.expanded && (
          <div className="border-b border-stone-100 px-4 pt-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {props.recipes.map(recipe => <button key={recipe.label} type="button" disabled={props.loading}
                onClick={recipe.onSelect} className="rounded-md bg-stone-100 px-2.5 py-1.5 text-xs text-stone-700 hover:bg-stone-200 disabled:opacity-50">{recipe.label}</button>)}
              {props.messages.length > 0 && <button type="button" onClick={props.onClear}
                className="px-2 py-1 text-xs text-stone-500 disabled:opacity-50">Clear</button>}
              <button type="button" aria-label="Collapse assistant" onClick={collapse}
                className="ml-auto rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="h-4 w-4" /></button>
            </div>
            <div aria-live="polite" aria-busy={props.loading} className="max-h-[32vh] space-y-3 overflow-y-auto pb-3 text-sm leading-6">
              {props.messages.map((message, index) => <div key={index}
                className={message.role === 'user' ? 'ml-8 rounded-lg bg-stone-100 px-3 py-2' : 'px-1 text-stone-700'}>
                {message.role === 'assistant' ? <AssistantMessage content={message.content} sources={message.sources} notice={message.notice} /> : message.content}
              </div>)}
              {props.loading && <p className="flex items-center gap-2 text-stone-500"><Loader2 className="h-4 w-4 animate-spin" />Writing an answer…</p>}
            </div>
          </div>
        )}
        <form className="flex items-center gap-2 p-2" onSubmit={event => { event.preventDefault(); if (props.canSend && !props.loading && props.input.trim()) props.onSend(); }}>
          <Sparkles aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 text-stone-400" />
          <input ref={inputRef} aria-label="Ask about this meeting" value={props.input} onChange={event => props.onInputChange(event.target.value)}
            placeholder="Ask anything about this meeting" className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-stone-400 rounded-md" />
          {!props.expanded && !props.input && <button type="button" onClick={() => props.onExpandedChange(true)}
            className="rounded-md px-3 py-2 text-xs text-stone-600 hover:bg-stone-100">Recipes{props.messages.length > 0 ? ' & answers' : ''}</button>}
          {props.loading ? <button type="button" onClick={props.onStop} aria-label="Stop answer"
            className="rounded-lg bg-stone-900 px-3 py-2.5 text-sm text-white">Stop</button> :
          <button type="submit" aria-label="Send question" disabled={!props.input.trim() || !props.canSend}
            className="rounded-lg bg-stone-900 p-2.5 text-white disabled:opacity-30"><Send className="h-4 w-4" /></button>}
        </form>
      </div>
    </aside>
  );
}
