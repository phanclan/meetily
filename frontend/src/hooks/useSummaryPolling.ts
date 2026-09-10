import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type Completion = { meeting_id: string; saved_at_ms: number };
type Poll = {
  timer: ReturnType<typeof setInterval>;
  reading: boolean;
  refresh: (urgent?: boolean) => Promise<void>;
  refreshPending: boolean;
  savedAt?: number;
};

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
    const startedAt = Date.now();
    let poll: Poll;
    const current = () => polls.current.get(meetingId) === poll;
    const refresh = async (urgent = false) => {
      if (!current()) return;
      if (poll.reading) {
        // A completion arriving during an older read must not wait for the next tick.
        if (urgent) poll.refreshPending = true;
        return;
      }
      poll.reading = true;
      const readStartedAt = Date.now();
      let result: any;
      try {
        result = readStartedAt - startedAt >= 1_000_000
          ? { status: 'error', error: 'Summary generation timed out. Reopen the meeting to check its progress.' }
          : await invoke('api_get_summary', { meetingId });
      } catch (error) {
        result = { status: 'error', error: error instanceof Error ? error.message : String(error) };
      }
      try {
        if (!current()) return;
        const terminal = ['completed', 'error', 'failed', 'cancelled'].includes(result.status);
        if (result.status === 'idle' && Date.now() - startedAt >= 5000) {
          result = { ...result, status: 'error', error: 'This enhancement is no longer running. Try enhancing again.' };
        }
        if (result.status === 'completed') {
          // Timing metadata only; do not log the generated document or source text.
          const observedAt = Date.now();
          console.log('Enhancement result observed', {
            meetingId,
            fetchMs: observedAt - readStartedAt,
            afterSavedEventMs: poll.savedAt === undefined ? null : Math.max(0, observedAt - poll.savedAt),
          });
        }
        try { await onUpdate(result); }
        catch (error) { console.error('Could not apply summary progress:', error); }
        if (current() && (terminal || result.status === 'error')) stopSummaryPolling(meetingId);
      } finally {
        poll.reading = false;
        if (current() && poll.refreshPending) {
          poll.refreshPending = false;
          void refresh();
        }
      }
    };
    const timer = setInterval(() => refresh(), 5000);
    poll = { timer, reading: false, refresh, refreshPending: false };
    polls.current.set(meetingId, poll);
    publish();
    // Covers a job finishing before the observer starts (or while navigating).
    void refresh();
  }, [publish, stopSummaryPolling]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<Completion>('summary-completed', ({ payload }) => {
      if (disposed) return;
      const poll = polls.current.get(payload.meeting_id);
      if (!poll) return;
      if (Number.isFinite(payload.saved_at_ms)) poll.savedAt = payload.saved_at_ms;
      void poll.refresh(true);
    }).then(release => {
      if (disposed) { release(); return; }
      unlisten = release;
      // Close the async subscription gap; completion could precede registration.
      polls.current.forEach(poll => { void poll.refresh(true); });
    }).catch(() => {
      console.warn('Enhancement events unavailable; polling remains active.');
    });
    return () => {
      disposed = true;
      unlisten?.();
      polls.current.forEach(poll => clearInterval(poll.timer));
      polls.current.clear();
    };
  }, []);
  return { activeSummaryPolls, startSummaryPolling, stopSummaryPolling };
}
