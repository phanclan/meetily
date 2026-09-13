'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';
import type { MeetingSource } from '@/lib/meetingAnswerContext';
import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { createSavedNotePath } from '@/lib/savedNoteRoute';

const noSources: MeetingSource[] = [];

/** Model output is Markdown, never trusted HTML. */
export function AssistantMessage({ content, sources = noSources, notice, coverage, copyable = true }: { content: string; sources?: MeetingSource[]; notice?: string; coverage?: string; copyable?: boolean }) {
  const [selected, setSelected] = useState<MeetingSource | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => { setCopyStatus('idle'); }, [content]);
  const copyAnswer = async () => {
    try {
      // Keep source labels useful outside the app, without dead in-app links.
      const text = content.replace(/\[([^\]]+)\]\(#source-[^)]+\)/g, '$1');
      await navigator.clipboard.writeText(notice ? `${text}\n\n${notice}` : text);
      setCopyStatus('copied');
    } catch { setCopyStatus('error'); }
  };
  const trigger = useRef<HTMLButtonElement | null>(null);
  const excerpt = useRef<HTMLQuoteElement | null>(null);
  useEffect(() => { if (selected) excerpt.current?.focus(); }, [selected]);
  const closeSource = () => { setSelected(null); trigger.current?.focus(); };
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith('#source-')) {
        const source = sources.find(item => href === `#source-${item.id}`);
        return source ? <button type="button" aria-label={`Show source ${source.id}: ${source.label}`} title={source.label}
          onClick={event => { trigger.current = event.currentTarget; setSelected(source); }}
          className="mx-0.5 inline rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600 hover:bg-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-500">{children}</button>
          : <span title="Source not available">{children}</span>;
      }
      return <a href={href}>{children}</a>;
    },
  }), [sources]);
  return (
    <div className="assistant-markdown min-w-0 break-words">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>{content}</Markdown>
      {coverage && <p className="mt-2 text-xs leading-5 text-stone-500">{coverage}</p>}
      {notice && <p role="status" className="mt-2 text-xs text-stone-500">{notice}</p>}
      {selected && <section aria-label="Source cited by this answer" className="my-3 rounded-lg border border-stone-200 bg-stone-50 p-3"
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeSource(); } }}>
        <div className="flex items-center justify-between gap-3 text-xs text-stone-600">
          <span>{selected.id} · {selected.label}</span>
          <button type="button" onClick={closeSource} className="rounded px-1.5 py-1 hover:bg-stone-200" aria-label="Close source excerpt">Close</button>
        </div>
        <blockquote ref={excerpt} tabIndex={0} className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-stone-800">{selected.text}</blockquote>
        {selected.meetingId && <Link href={createSavedNotePath(selected.meetingId)} className="mt-2 inline-block text-xs underline">Open meeting</Link>}
      </section>}
      {copyable && content && <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
        <button type="button" aria-label="Copy answer" onClick={() => void copyAnswer()} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-400">
          {copyStatus === 'copied' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy
        </button>
        <span role="status">{copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Could not copy. Try again.' : ''}</span>
      </div>}
    </div>
  );
}
