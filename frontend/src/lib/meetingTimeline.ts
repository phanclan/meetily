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

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Open WebUI-style buckets that widen with age. */
export function meetingTimeRangeLabel(date: Date, now = new Date()): string {
  const dayKey = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(yesterday)) return 'Yesterday';

  const days = (now.getTime() - date.getTime()) / (1000 * 3600 * 24);
  if (days <= 7) return 'Previous 7 days';
  if (days <= 30) return 'Previous 30 days';
  if (date.getFullYear() === now.getFullYear()) return MONTHS[date.getMonth()];
  return String(date.getFullYear());
}

const TIME_RANGE_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days'] as const;

function timeRangeSortKey(label: string, now = new Date()): number {
  const fixed = TIME_RANGE_ORDER.indexOf(label as typeof TIME_RANGE_ORDER[number]);
  if (fixed >= 0) return fixed;
  const monthIndex = MONTHS.indexOf(label as typeof MONTHS[number]);
  if (monthIndex >= 0) {
    // Same-year months: newer months first after the fixed buckets.
    return 100 + (11 - monthIndex);
  }
  const year = Number(label);
  if (Number.isFinite(year)) {
    // Older years after current-year months.
    return 1000 + (now.getFullYear() - year);
  }
  return 10_000;
}

/** Group meetings like Open WebUI's chat sidebar (Today → … → month → year). */
export function groupMeetingsByTimeRange<T extends { created_at?: string }>(meetings: T[], now = new Date()) {
  const groups = new Map<string, { key: string; label: string; meetings: T[] }>();
  for (const meeting of meetings) {
    const date = new Date(meeting.created_at || '');
    const valid = Number.isFinite(date.getTime());
    const label = !valid ? 'Date unavailable' : meetingTimeRangeLabel(date, now);
    const key = label;
    if (!groups.has(key)) groups.set(key, { key, label, meetings: [] });
    groups.get(key)!.meetings.push(meeting);
  }
  return [...groups.values()].sort(
    (a, b) => timeRangeSortKey(a.label, now) - timeRangeSortKey(b.label, now),
  );
}
