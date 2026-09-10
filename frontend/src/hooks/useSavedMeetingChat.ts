import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveMeetingChat } from './useLiveMeetingChat';
import { meetnolaInvoke } from '@/meetnola/ipc';
import { createWriteQueue, registerBeforeQuit } from '@/lib/pendingWrites';
import { decodeMeetingChat, encodeMeetingChat } from '@/lib/meetingChatHistory';
import type { ChatMessage } from './useLiveMeetingChat';

const emptyMessages: ChatMessage[] = [];

/** Saved meetings own their conversations. */
export function useSavedMeetingChat(meetingId: string) {
  return usePersistentChat(meetingId);
}

/** Share ordered persistence without merging library and per-meeting ownership. */
export function usePersistentChat(recordId: string, scope: 'meeting' | 'library' | 'recording' = 'meeting') {
  const meetingId = scope === 'meeting' ? recordId : `${scope}:${recordId}`;
  const chat = useLiveMeetingChat(meetingId);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Match TranscriptsRepository's stable saved ID so navigation to the saved
  // document waits for any final write from its live workspace.
  const queueId = scope === 'recording' ? `meeting-recording-${recordId}` : meetingId;
  const queue = useMemo(() => createWriteQueue(`meeting-chat:${queueId}`), [queueId]);
  const ready = Boolean(recordId) && restoredFor === meetingId;
  const latest = useRef<{ meetingId: string; messages: typeof chat.messages; loading: boolean } | null>(null);
  if (ready) latest.current = { meetingId, messages: chat.messages, loading: chat.isLoading };
  const owner = useRef(meetingId);
  owner.current = meetingId;
  const persist = useCallback((messages: typeof chat.messages, interrupted: boolean) => {
    const messagesJson = encodeMeetingChat(messages, interrupted);
    return queue.enqueue(() => meetnolaInvoke<void>(`save_${scope}_chat`, { ...chatOwner(recordId, scope), messagesJson }));
  }, [recordId, scope, queue]);

  useEffect(() => registerBeforeQuit(async () => {
    const snapshot = latest.current;
    if (snapshot?.meetingId === meetingId && snapshot.loading) await persist(snapshot.messages, true);
  }), [meetingId, persist]);

  useEffect(() => {
    let cancelled = false;
    setRestoredFor(null);
    setHistoryError(null);
    if (!recordId) return;
    void (async () => {
      try {
        await queue.flush();
        const saved = await meetnolaInvoke<string | null>(`get_${scope}_chat`, chatOwner(recordId, scope));
        if (cancelled || owner.current !== meetingId) return;
        chat.restoreMessages(decodeMeetingChat(saved));
        setRestoredFor(meetingId);
      } catch (error) {
        if (!cancelled && owner.current === meetingId) setHistoryError(String(error));
      }
    })();
    return () => {
      cancelled = true;
      const snapshot = latest.current;
      if (snapshot?.meetingId === meetingId && snapshot.loading) {
        // Flush the visible partial on navigation. Failed writes remain in the quit queue.
        void persist(snapshot.messages, true).catch(() => {});
      }
    };
  }, [meetingId, recordId, scope, queue, chat.restoreMessages, persist, reload]);

  useEffect(() => {
    if (!ready) return;
    // Persist the question immediately and the completed/stopped answer, not every token.
    if (chat.isLoading && chat.messages.at(-1)?.role !== 'user') return;
    let current = true;
    void persist(chat.messages, chat.isLoading).then(() => {
      if (current && owner.current === meetingId) setHistoryError(null);
    }).catch(error => {
      if (current && owner.current === meetingId) setHistoryError(`Conversation not saved: ${String(error)}`);
    });
    return () => { current = false; };
  }, [chat.messages, chat.isLoading, ready, meetingId, persist]);

  const retryHistory = useCallback(() => {
    if (!ready) { setReload(value => value + 1); return; }
    void persist(chat.messages, chat.isLoading).then(() => {
      if (owner.current === meetingId) setHistoryError(null);
    }).catch(error => {
      if (owner.current === meetingId) setHistoryError(`Conversation not saved: ${String(error)}`);
    });
  }, [ready, persist, chat.messages, chat.isLoading, meetingId]);

  return { ...chat, messages: ready ? chat.messages : emptyMessages, ready, historyError, retryHistory, flushHistory: queue.flush,
    send: useCallback<typeof chat.send>((...args) => ready ? chat.send(...args) : Promise.resolve(), [ready, chat.send]),
    clearMessages: useCallback(() => { if (ready) chat.clearMessages(); }, [ready, chat.clearMessages]),
  };
}

function chatOwner(recordId: string, scope: 'meeting' | 'library' | 'recording') {
  return scope === 'meeting' ? { meetingId: recordId }
    : scope === 'recording' ? { recordingId: recordId } : { chatId: recordId };
}
