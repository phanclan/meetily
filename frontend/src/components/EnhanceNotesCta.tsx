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
      className="inline-flex items-center gap-2 rounded-full bg-[#6f7d32] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-22px_rgba(69,82,22,0.7)] transition-colors hover:bg-[#5f6b2b] disabled:cursor-not-allowed disabled:bg-[#a7b27c] disabled:shadow-none"
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {isLoading ? 'Enhancing notes…' : 'Enhance notes'}
    </button>
  );
}
