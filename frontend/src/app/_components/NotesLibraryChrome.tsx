'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { homeLibraryPath } from '@/lib/askRoute';

type NotesLibraryView = 'recent' | 'all' | 'follow-ups';

const tabClass =
  'rounded-full px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100 aria-pressed:bg-stone-100 aria-pressed:text-stone-900';

export function NotesLibraryTabs({
  current,
  folderId = '',
  filter = '',
  onRecent,
}: {
  current: NotesLibraryView;
  folderId?: string;
  filter?: string;
  onRecent?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const librarySearch = searchParams.toString();
  const folderQuery = folderId ? `?folder=${encodeURIComponent(folderId)}` : '';

  return (
    <div className="flex gap-1" aria-label="Meeting list view">
      <button
        type="button"
        aria-pressed={current === 'follow-ups'}
        className={tabClass}
        onClick={() => router.push(`/follow-ups${folderQuery}`)}
      >
        Follow-ups
      </button>
      <button
        type="button"
        aria-pressed={current === 'recent'}
        className={tabClass}
        onClick={() => {
          onRecent?.();
          router.push(homeLibraryPath(librarySearch, { view: null, folder: null, q: null }));
        }}
      >
        Recent
      </button>
      <button
        type="button"
        aria-pressed={current === 'all'}
        className={tabClass}
        onClick={() => router.push(homeLibraryPath(librarySearch, {
          view: 'all',
          folder: folderId || null,
          q: filter || null,
        }))}
      >
        All notes
      </button>
    </div>
  );
}

/** Always-on folder/search row so Recent ↔ All notes / Follow-ups does not jump. */
export function NotesLibraryToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex min-h-9 min-w-0 flex-nowrap items-center gap-2">
      {children}
    </div>
  );
}
