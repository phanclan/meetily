'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SearchCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_SUMMARY_CLAIM_LENGTH, selectedSummaryClaim } from '@/lib/summaryClaim';

export function SummaryClaimCheck({ children, enabled, onCheck }: {
  children: ReactNode;
  enabled: boolean;
  onCheck: (claim: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [claim, setClaim] = useState('');

  useEffect(() => {
    if (!enabled) { setClaim(''); return; }
    const capture = () => {
      if (!contentRef.current) return;
      // Keep the captured quote when keyboard users tab to its action.
      const selection = window.getSelection();
      if (selection?.isCollapsed && document.activeElement === buttonRef.current) return;
      setClaim(selectedSummaryClaim(selection, contentRef.current));
    };
    document.addEventListener('selectionchange', capture);
    return () => document.removeEventListener('selectionchange', capture);
  }, [enabled]);

  const tooLong = claim.length > MAX_SUMMARY_CLAIM_LENGTH;
  const check = () => {
    if (enabled && claim && !tooLong) {
      onCheck(claim);
      window.getSelection()?.removeAllRanges();
    }
  };
  return <div onKeyDownCapture={event => {
    if (event.key === 'Enter' && event.shiftKey && (event.metaKey || event.ctrlKey) && enabled && claim && !tooLong) {
      event.preventDefault();
      event.stopPropagation();
      check();
    }
  }}>
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button ref={buttonRef} type="button" variant="ghost" size="sm"
        disabled={!enabled || !claim || tooLong}
        onMouseDown={event => event.preventDefault()}
        onClick={check}
        title="Check original sources (Ctrl/⌘+Shift+Enter)"
        aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
        aria-describedby="summary-claim-help" className="-ml-2 text-stone-600">
        <SearchCheck className="h-3.5 w-3.5" />Check selected text
      </Button>
      <p id="summary-claim-help" className="text-xs text-stone-500">
        {tooLong ? 'Select a shorter statement (up to 1,200 characters).' : 'Select a statement to check its sources.'}
      </p>
    </div>
    <div ref={contentRef} onInput={() => setClaim('')}>{children}</div>
  </div>;
}
