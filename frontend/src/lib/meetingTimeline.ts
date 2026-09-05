/** Group by the user's calendar day, including across daylight-saving changes. */
export function groupMeetingsByDay<T extends { created_at?: string }>(meetings: T[], now = new Date()) {
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, { key: string; label: string; meetings: T[] }>();
  for (const meeting of meetings) {
    const date = new Date(meeting.created_at || '');
    const valid = Number.isFinite(date.getTime());
    const key = valid ? dayKey(date) : 'unknown';
    const label = !valid ? 'Date unavailable' : key === dayKey(now) ? 'Today'
      : key === dayKey(yesterday) ? 'Yesterday'
      : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric',
          ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
    if (!groups.has(key)) groups.set(key, { key, label, meetings: [] });
    groups.get(key)!.meetings.push(meeting);
  }
  return [...groups.values()];
}
