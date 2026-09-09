'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';
import type { MeetingSource } from '@/lib/meetingAnswerContext';

const noSources: MeetingSource[] = [];

/** Model output is Markdown, never trusted HTML. */
export function AssistantMessage({ content, sources = noSources }: { content: string; sources?: MeetingSource[] }) {
  const [selected, setSelected] = useState<MeetingSource | null>(null);
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
      {selected && <section aria-label="Source cited by this answer" className="my-3 rounded-lg border border-stone-200 bg-stone-50 p-3"
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeSource(); } }}>
        <div className="flex items-center justify-between gap-3 text-xs text-stone-600">
          <span>{selected.id} · {selected.label}</span>
          <button type="button" onClick={closeSource} className="rounded px-1.5 py-1 hover:bg-stone-200" aria-label="Close source excerpt">Close</button>
        </div>
        <blockquote ref={excerpt} tabIndex={0} className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-stone-800">{selected.text}</blockquote>
      </section>}
    </div>
  );
}
