'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { findNoteRanges } from '@/lib/noteFind';

export function FindInNote({ open, onOpenChange, contentRef, returnFocusRef, scopeKey }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentRef: RefObject<HTMLDivElement | null>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  scopeKey: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ ranges: Range[]; truncated: boolean }>({ ranges: [], truncated: false });
  const [index, setIndex] = useState(0);
  const reveal = useCallback((range?: Range) => {
    const scroll = contentRef.current?.closest<HTMLElement>('[data-note-scroll]');
    if (!range || !scroll) return;
    const rect = range.getBoundingClientRect();
    const viewport = scroll.getBoundingClientRect();
    scroll.scrollBy({ top: rect.top - viewport.top - viewport.height / 2 + rect.height / 2 });
  }, [contentRef]);
  const move = useCallback((direction: number) => {
    const next = result.ranges.length ? (index + direction + result.ranges.length) % result.ranges.length : 0;
    setIndex(next);
    reveal(result.ranges[next]);
  }, [index, result.ranges, reveal]);
  const close = useCallback(() => {
    onOpenChange(false);
    const target = previousFocus.current?.isConnected ? previousFocus.current : returnFocusRef.current;
    target?.focus({ preventScroll: true });
  }, [onOpenChange, returnFocusRef]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (!open) previousFocus.current = document.activeElement as HTMLElement;
        onOpenChange(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (open && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        move(event.shiftKey ? -1 : 1);
      } else if (open && event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [open, onOpenChange, move, close]);

  useEffect(() => {
    if (!open) { setQuery(''); setResult({ ranges: [], truncated: false }); return; }
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || !contentRef.current) return;
    const root = contentRef.current;
    let frame = 0;
    const update = (navigate: boolean) => {
      const next = findNoteRanges(root, query);
      setResult(next);
      setIndex(current => navigate ? 0 : Math.min(current, Math.max(0, next.ranges.length - 1)));
      if (navigate) reveal(next.ranges[0]);
    };
    update(true);
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(false));
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [open, query, scopeKey, contentRef, reveal]);

  useEffect(() => {
    if (!open) return;
    const active = result.ranges[index];
    // Custom highlights paint ranges without changing content or editor selection.
    if (typeof Highlight !== 'undefined' && CSS.highlights) {
      CSS.highlights.set('note-find-all', new Highlight(...result.ranges));
      CSS.highlights.set('note-find-current', new Highlight(...(active ? [active] : [])));
    }
    return () => {
      CSS.highlights?.delete('note-find-all');
      CSS.highlights?.delete('note-find-current');
    };
  }, [open, result, index, contentRef]);

  if (!open) return null;
  const count = query.trim() ? result.ranges.length ? `${index + 1} of ${result.ranges.length}${result.truncated ? '+' : ''}` : 'No matches' : '';
  return <div role="search" aria-label="Find in note" className="shrink-0 border-b border-stone-200 bg-background px-3 py-2">
    <div className="mx-auto flex max-w-3xl items-center gap-1">
      <Search aria-hidden="true" className="mr-1 h-4 w-4 shrink-0 text-stone-500" />
      <input ref={inputRef} type="search" value={query} onChange={event => setQuery(event.target.value)}
        aria-label="Find in note" placeholder="Find in note…" aria-describedby="note-find-count"
        className="min-w-0 flex-1 appearance-none rounded-md border-0 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-stone-400 focus-visible:ring-2 focus-visible:ring-stone-400"
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
        }} />
      <span id="note-find-count" role="status" className="px-1 text-xs whitespace-nowrap text-stone-500">{count}</span>
      <Button variant="ghost" size="icon" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!result.ranges.length} onClick={() => move(-1)}><ArrowUp /></Button>
      <Button variant="ghost" size="icon" aria-label="Next match" title="Next match (Enter)" disabled={!result.ranges.length} onClick={() => move(1)}><ArrowDown /></Button>
      <Button variant="ghost" size="icon" aria-label="Close find" title="Close find (Escape)" onClick={close}><X /></Button>
    </div>
  </div>;
}
