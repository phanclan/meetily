import { useCallback, useRef, useState } from 'react';

/** Background recorder metadata must never overwrite a title edited in this session. */
export function useRecordingTitle() {
  const [meetingTitle, setTitle] = useState('+ New Call');
  const revision = useRef(0);
  const edited = useRef(false);

  const beginSession = useCallback(() => {
    revision.current += 1;
    edited.current = false;
  }, []);

  const setMeetingTitle = useCallback((title: string) => {
    revision.current += 1;
    edited.current = true;
    setTitle(title);
  }, []);

  const syncMeetingTitle = useCallback(async (load: () => Promise<string | null | undefined>) => {
    const startedAt = revision.current;
    const title = await load();
    if (title && startedAt === revision.current && !edited.current) {
      setTitle(title);
    }
  }, []);

  return { meetingTitle, setMeetingTitle, beginSession, syncMeetingTitle };
}
