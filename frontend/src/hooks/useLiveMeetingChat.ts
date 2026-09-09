import { useState, useCallback, useRef, useEffect } from 'react';
import { liveQuery } from '@/meetnola/ipc';
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

  useEffect(() => {
    epoch.current += 1;
    active.current = false;
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
      });
      if (epoch.current === requestEpoch) setMessages(prev => [...prev, { role: 'assistant', content: response, sources: context.sources }]);
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
    setIsLoading(false);
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, send, clearMessages };
}
