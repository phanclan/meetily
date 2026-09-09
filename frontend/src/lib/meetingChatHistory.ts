import type { ChatMessage } from '@/hooks/useLiveMeetingChat';

export function encodeMeetingChat(messages: ChatMessage[], interrupted = false): string {
  const saved = messages.map(({ role, content, sources, notice, coverage, sourceMeetingIds }) => {
    const cited = new Set([...content.matchAll(/#source-(S\d+)/g)].map(match => match[1]));
    // Keep all consulted meeting IDs for deletion, without storing uncited excerpts.
    const meetings = [...new Set([...(sourceMeetingIds || []), ...(sources || []).flatMap(source => source.meetingId ? [source.meetingId] : [])])];
    return { role, content, notice, coverage, ...(meetings.length ? { sourceMeetingIds: meetings } : {}), ...(sources ? { sources: sources.filter(source => cited.has(source.id)) } : {}) };
  });
  if (interrupted && saved.length) {
    const last = saved[saved.length - 1];
    const notice = 'Response interrupted. This answer is incomplete.';
    if (last.role === 'assistant') last.notice = notice;
    else saved.push({ role: 'assistant', content: '', notice, coverage: undefined });
  }
  return JSON.stringify(saved);
}

export function decodeMeetingChat(json: string | null): ChatMessage[] {
  if (json === null) return [];
  const messages: unknown = JSON.parse(json);
  if (!Array.isArray(messages) || messages.some(message =>
    !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
    || (message.notice !== undefined && typeof message.notice !== 'string')
    || (message.coverage !== undefined && typeof message.coverage !== 'string')
    || (message.sourceMeetingIds !== undefined && (!Array.isArray(message.sourceMeetingIds) || message.sourceMeetingIds.some((id: unknown) => typeof id !== 'string')))
    || (message.sources !== undefined && (!Array.isArray(message.sources) || message.sources.some((source: unknown) => {
      const item = source as { id?: unknown; label?: unknown; text?: unknown; meetingId?: unknown } | null;
      return !item || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.text !== 'string' || (item.meetingId !== undefined && typeof item.meetingId !== 'string');
    })))
  )) throw new Error('Saved conversation could not be read. It has not been overwritten.');
  return messages;
}
