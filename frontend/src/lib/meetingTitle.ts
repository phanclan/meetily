/** Placeholder / auto-generated meeting titles that Enhance may replace. */

const GENERATED_TITLE_PATTERNS = [
  // Current generator: Meeting DD_MM_YY_HH_MM_SS
  /^Meeting \d{2}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$/,
  // Legacy generator: Meeting YYYY-MM-DD_HH-MM-SS
  /^Meeting \d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/,
];

const NAMED_PLACEHOLDERS = new Set([
  '',
  'New note',
  '+ New Call',
  'Untitled meeting',
  'Untitled',
  'Untitled Meeting',
  'New Meeting',
]);

export function isGeneratedMeetingTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return false;
  return GENERATED_TITLE_PATTERNS.some(pattern => pattern.test(trimmed));
}

export function isNamedDraftPlaceholder(title: string): boolean {
  return NAMED_PLACEHOLDERS.has(title.trim());
}

/** True for empty/draft labels and auto timestamp titles — Enhance may replace these. */
export function isPlaceholderMeetingTitle(title: string): boolean {
  const trimmed = title.trim();
  if (isNamedDraftPlaceholder(trimmed)) return true;
  return isGeneratedMeetingTitle(trimmed);
}

/**
 * Seed a workspace title without letting draft "New note" wipe a real session title.
 * User-edited custom titles win; otherwise keep a generated/AI session title.
 */
export function resolveSeededMeetingTitle(seedTitle: string, sessionTitle: string): string {
  const seed = seedTitle.trim();
  const session = sessionTitle.trim();
  const seedIsUserTitle = Boolean(seed) && !isNamedDraftPlaceholder(seed) && !isGeneratedMeetingTitle(seed);
  if (seedIsUserTitle) return seed;
  // Keep generated timestamp or any non-draft session title over draft placeholders.
  if (session && !isNamedDraftPlaceholder(session)) return session;
  return seed || session || 'New note';
}

function normalizeTitleLine(line: string): string {
  let text = line.trim().replace(/^#+\s*/, '').trim();
  text = text.replace(/^([-*>]\s+|\[[ xX]\]\s+)/, '').trim();
  const numbered = text.match(/^(\d+)\.\s+(.*)$/);
  if (numbered) text = numbered[2].trim();
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Derive a short title from notes or transcript text (same spirit as Rust
 * `derive_title_from_notes`). Returns null when nothing substantial is found.
 */
export function deriveTitleFromText(source: string): string | null {
  for (const line of source.split(/\r?\n/)) {
    let candidate = normalizeTitleLine(line);
    if (candidate.length < 4) continue;
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) continue;

    if (candidate.length > 96) {
      candidate = candidate.slice(0, 96).trim();
      const lastSpace = candidate.lastIndexOf(' ');
      if (lastSpace > 0) candidate = candidate.slice(0, lastSpace);
    }

    if (candidate) return candidate;
  }
  return null;
}

/**
 * Pick a title to persist at stop/save: keep custom/generated titles, and only
 * derive from transcript/notes text when still stuck on a named placeholder.
 */
export function resolvePersistedMeetingTitle(options: {
  uiTitle?: string | null;
  sessionTitle?: string | null;
  savedMeetingName?: string | null;
  sourceText?: string | null;
}): string {
  const candidates = [options.uiTitle, options.sessionTitle, options.savedMeetingName]
    .map(value => (value ?? '').trim())
    .filter(Boolean);

  const nonPlaceholder = candidates.find(title => !isNamedDraftPlaceholder(title));
  if (nonPlaceholder) return nonPlaceholder;

  const derived = options.sourceText ? deriveTitleFromText(options.sourceText) : null;
  if (derived) return derived;

  return candidates[0] || 'New note';
}

/**
 * On resume/append, always write a non-placeholder title to SQLite — even when the
 * UI already shows it. Comparing only to `meetingTitle` skipped saves when the open
 * note already adopted a generated timestamp while the home list still read "New note".
 */
export function shouldPersistTitleOnAppend(options: {
  persistedTitle: string | null | undefined;
  databaseTitle?: string | null;
}): boolean {
  const title = (options.persistedTitle ?? '').trim();
  if (!title || isNamedDraftPlaceholder(title)) return false;
  const dbTitle = (options.databaseTitle ?? '').trim();
  if (!dbTitle) return true;
  return title !== dbTitle;
}

/**
 * Apply a background Gateway title to the open editor only when the user has
 * not typed a custom name. The meeting list always takes the suggested title.
 */
export function shouldApplySuggestedMeetingTitle(
  currentTitle: string,
  previousTitle: string,
  suggestedTitle?: string | null,
): boolean {
  const current = currentTitle.trim();
  const previous = previousTitle.trim();
  const suggested = (suggestedTitle ?? '').trim();
  if (!suggested || current === suggested) return false;
  return isPlaceholderMeetingTitle(current) || current === previous;
}
