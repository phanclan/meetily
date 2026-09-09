import { useState, useCallback, useRef, useEffect } from 'react';
import { liveQuery, type MeetingExchange } from '@/meetnola/ipc';
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

  useEffect(() => {
    epoch.current += 1;
    active.current = false;
    history.current = [];
    setMessages([]);
    setIsLoading(false);
    setError(null);
    return () => { epoch.current += 1; };
  }, [meetingId]);

  const send = useCallback(async (userMessage: string, source: string | (() => Promise<MeetingAnswerContext>)) => {
    if (!userMessage.trim() || active.current) return;
    active.current = true;
    const requestEpoch = epoch.current;

    const userMsg: ChatMessage = { role: 'user', content: userMessage };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      const context = typeof source === 'string' ? { context: source, sources: undefined } : await source();
      if (epoch.current !== requestEpoch) return;
      if (!context.context.trim()) throw new Error('Add notes or record a transcript before asking about this meeting.');
      const response = await liveQuery({
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
      if (epoch.current === requestEpoch) { active.current = false; setIsLoading(false); }
    }
  }, []);

  const clearMessages = useCallback(() => {
    epoch.current += 1;
    active.current = false;
    history.current = [];
    setIsLoading(false);
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, send, clearMessages };
}
