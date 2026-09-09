import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type Poll = { timer: ReturnType<typeof setInterval>; reading: boolean };

/** Independent observers of native jobs. Stopping an observer never cancels a job. */
export function useSummaryPolling() {
  const polls = useRef(new Map<string, Poll>());
  const [activeSummaryPolls, setActiveSummaryPolls] = useState<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const publish = useCallback(() => {
    setActiveSummaryPolls(new Map([...polls.current].map(([id, poll]) => [id, poll.timer])));
  }, []);
  const stopSummaryPolling = useCallback((meetingId: string) => {
    const poll = polls.current.get(meetingId);
    if (!poll) return;
    clearInterval(poll.timer);
    polls.current.delete(meetingId);
    publish();
  }, [publish]);
  const startSummaryPolling = useCallback((meetingId: string, _processId: string,
    onUpdate: (result: any) => void | Promise<void>) => {
    stopSummaryPolling(meetingId);
    let count = 0;
    let poll: Poll;
    const current = () => polls.current.get(meetingId) === poll;
    const timer = setInterval(async () => {
      if (!current() || poll.reading) return;
      poll.reading = true;
      let result: any;
      try {
        result = ++count >= 200
          ? { status: 'error', error: 'Summary generation timed out. Reopen the meeting to check its progress.' }
          : await invoke('api_get_summary', { meetingId });
      } catch (error) {
        result = { status: 'error', error: error instanceof Error ? error.message : String(error) };
      }
      try {
        if (!current()) return;
        const terminal = ['completed', 'error', 'failed', 'cancelled'].includes(result.status);
        if (result.status === 'idle' && count > 1) {
          result = { ...result, status: 'error', error: 'This enhancement is no longer running. Try enhancing again.' };
        }
        try { await onUpdate(result); }
        catch (error) { console.error('Could not apply summary progress:', error); }
        if (current() && (terminal || result.status === 'error')) stopSummaryPolling(meetingId);
      } finally {
        poll.reading = false;
      }
    }, 5000);
    poll = { timer, reading: false };
    polls.current.set(meetingId, poll);
    publish();
  }, [publish, stopSummaryPolling]);
  useEffect(() => () => {
    polls.current.forEach(poll => clearInterval(poll.timer));
    polls.current.clear();
  }, []);
  return { activeSummaryPolls, startSummaryPolling, stopSummaryPolling };
}
