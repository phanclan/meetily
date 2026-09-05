import { useState, useCallback } from 'react';
import { liveQuery } from '@/meetnola/ipc';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function useLiveMeetingChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (userMessage: string, transcriptContext: string) => {
    if (!userMessage.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: userMessage };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await liveQuery({
        userMessage,
        transcriptContext,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, send, clearMessages };
}
