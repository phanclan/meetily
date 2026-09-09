import { useState, useCallback, useRef, useEffect } from 'react';
import { liveQuery, prepareLiveQuery, cancelLiveQuery, type MeetingExchange } from '@/meetnola/ipc';
import type { MeetingAnswerContext, MeetingSource } from '@/lib/meetingAnswerContext';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: MeetingSource[];
  requestId?: string;
  notice?: string;
}

// Local models sometimes emit plain markers despite the link-format instruction.
// Only known source IDs become links; code examples and existing links stay intact.
export function linkMeetingCitations(text: string, sources: MeetingSource[] = []): string {
  const known = new Set(sources.map(source => source.id));
  return text.replace(/```[\s\S]*?```|`[^`]*`|\[S\d+\](?!\()/g, marker => {
    const id = marker.slice(1, -1);
    return known.has(id) ? `${marker}(#source-${id})` : marker;
  });
}

export function useLiveMeetingChat(meetingId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const epoch = useRef(0);
  const history = useRef<MeetingExchange[]>([]);
  const requestId = useRef<string | null>(null);
  const partial = useRef<{ flush: () => void; dispose: () => void } | null>(null);
  const cancelCurrent = useCallback(() => {
    partial.current?.flush();
    partial.current?.dispose();
    partial.current = null;
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
    let pending: { flush: () => void; dispose: () => void } | null = null;
    let settled = false;
    try {
      const context = typeof source === 'string' ? { context: source, sources: undefined } : await source();
      if (epoch.current !== requestEpoch) return;
      if (!context.context.trim()) throw new Error('Add notes or record a transcript before asking about this meeting.');
      id = await prepareLiveQuery();
      if (epoch.current !== requestEpoch) return;
      requestId.current = id;
      let text = '';
      let timer: ReturnType<typeof setTimeout> | null = null;
      let shown = false;
      const publish = (content: string) => {
        if (epoch.current !== requestEpoch) return;
        setMessages(prev => {
          if (epoch.current !== requestEpoch) return prev;
          const message: ChatMessage = { role: 'assistant', content: linkMeetingCitations(content, context.sources), sources: context.sources, requestId: id! };
          return prev.some(item => item.requestId === id)
            ? prev.map(item => item.requestId === id ? message : item) : [...prev, message];
        });
      };
      pending = {
        flush: () => { if (text && !settled) publish(text); },
        dispose: () => { if (timer !== null) clearTimeout(timer); timer = null; },
      };
      partial.current = pending;
      const response = await liveQuery({
        requestId: id,
        userMessage,
        transcriptContext: context.context,
        history: history.current,
      }, delta => {
        if (settled || epoch.current !== requestEpoch || !delta) return;
        text += delta;
        // Show the first text immediately; batch subsequent tokens to 20 updates/sec.
        if (!shown) { shown = true; pending?.flush(); }
        else if (timer === null) timer = setTimeout(() => { timer = null; pending?.flush(); }, 50);
      });
      pending.dispose();
      settled = true;
      if (epoch.current === requestEpoch) {
        // Earlier citation IDs refer to older source snapshots, not today's context.
        const answer = linkMeetingCitations(response, context.sources).replace(/\[S\d+\]\(#source-S\d+\)/g, '');
        history.current = [...history.current, { question: userMessage, answer }].slice(-6);
        publish(response);
      }
    } catch (err) {
      if (epoch.current !== requestEpoch) return;
      pending?.flush();
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages(prev => id && prev.some(item => item.requestId === id)
        ? prev.map(item => item.requestId === id ? { ...item, notice: `Incomplete answer: ${msg}` } : item)
        : [...prev, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      settled = true;
      pending?.dispose();
      if (partial.current === pending) partial.current = null;
      if (id) {
        if (requestId.current === id) requestId.current = null;
        // Also release a registration cancelled before liveQuery was dispatched.
        void cancelLiveQuery(id).catch(error => console.error('Could not release meeting question:', error));
      }
      if (epoch.current === requestEpoch) { active.current = false; setIsLoading(false); }
    }
  }, []);

  const stop = useCallback(() => {
    const id = requestId.current;
    cancelCurrent();
    if (id) setMessages(prev => prev.map(item => item.requestId === id ? { ...item, notice: "Stopped. This answer is incomplete." } : item));
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
