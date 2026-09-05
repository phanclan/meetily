'use client';

import { Loader2, Sparkles } from 'lucide-react';

interface EnhanceNotesCtaProps {
  disabled?: boolean;
  isLoading?: boolean;
  onClick: () => void;
}

export function EnhanceNotesCta({
  disabled = false,
  isLoading = false,
  onClick,
}: EnhanceNotesCtaProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {isLoading ? 'Enhancing notes…' : 'Enhance notes'}
    </button>
  );
}
