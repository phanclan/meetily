import { useState, useCallback, useRef, useEffect } from 'react';
import { liveQuery, prepareLiveQuery, cancelLiveQuery, type MeetingExchange } from '@/meetnola/ipc';
import type { MeetingAnswerContext, MeetingSource } from '@/lib/meetingAnswerContext';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: MeetingSource[];
}

export function useLiveMeetingChat(meetingId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const epoch = useRef(0);
  const history = useRef<MeetingExchange[]>([]);
  const requestId = useRef<string | null>(null);
  const cancelCurrent = useCallback(() => {
    epoch.current += 1;
    active.current = false;
    const id = requestId.current;
    requestId.current = null;
    if (id) void cancelLiveQuery(id).catch(error => console.error('Could not cancel meeting question:', error));
  }, []);

  useEffect(() => {
    cancelCurrent();
    history.current = [];
    setMessages([]);
    setIsLoading(false);
    setError(null);
    return cancelCurrent;
  }, [meetingId, cancelCurrent]);

  const send = useCallback(async (userMessage: string, source: string | (() => Promise<MeetingAnswerContext>)) => {
    if (!userMessage.trim() || active.current) return;
    active.current = true;
    const requestEpoch = epoch.current;

    const userMsg: ChatMessage = { role: 'user', content: userMessage };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    let id: string | null = null;
    try {
      const context = typeof source === 'string' ? { context: source, sources: undefined } : await source();
      if (epoch.current !== requestEpoch) return;
      if (!context.context.trim()) throw new Error('Add notes or record a transcript before asking about this meeting.');
      id = await prepareLiveQuery();
      if (epoch.current !== requestEpoch) return;
      requestId.current = id;
      const response = await liveQuery({
        requestId: id,
        userMessage,
        transcriptContext: context.context,
        history: history.current,
      });
      if (epoch.current === requestEpoch) {
        // Earlier citation IDs refer to older source snapshots, not today's context.
        const answer = response.replace(/\[S\d+\]\(#source-S\d+\)/g, '');
        history.current = [...history.current, { question: userMessage, answer }].slice(-6);
        setMessages(prev => [...prev, { role: 'assistant', content: response, sources: context.sources }]);
      }
    } catch (err) {
      if (epoch.current !== requestEpoch) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      if (id) {
        if (requestId.current === id) requestId.current = null;
        // Also release a registration cancelled before liveQuery was dispatched.
        void cancelLiveQuery(id).catch(error => console.error('Could not release meeting question:', error));
      }
      if (epoch.current === requestEpoch) { active.current = false; setIsLoading(false); }
    }
  }, []);

  const stop = useCallback(() => {
    cancelCurrent();
    setIsLoading(false);
    setError(null);
  }, [cancelCurrent]);

  const clearMessages = useCallback(() => {
    cancelCurrent();
    history.current = [];
    setIsLoading(false);
    setMessages([]);
    setError(null);
  }, [cancelCurrent]);

  return { messages, isLoading, error, send, clearMessages, stop };
}
