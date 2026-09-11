'use client';

import { NoteWorkspace } from '@/app/_components/NoteWorkspace';

/** Draft notes. This surface never starts or stops audio capture. */
export default function QuickNotePage() {
  return <NoteWorkspace mode="draft" />;
}
