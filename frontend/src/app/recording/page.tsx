'use client';

import { NoteWorkspace } from '@/app/_components/NoteWorkspace';

/**
 * The live recording workspace. Entering this route starts a session; reloading it
 * attaches to the session that is still running natively.
 */
export default function RecordingPage() {
  return <NoteWorkspace mode="recording" />;
}
