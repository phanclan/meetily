export interface QuickNoteDraft {
  title: string;
  content: string;
  updatedAt: number | null;
}

const QUICK_NOTE_TITLE_KEY = 'meetily.quick_note.title';
const QUICK_NOTE_CONTENT_KEY = 'meetily.quick_note.content';
const QUICK_NOTE_UPDATED_KEY = 'meetily.quick_note.updated_at';

export function loadQuickNoteDraft(): QuickNoteDraft {
  if (typeof window === 'undefined') {
    return {
      title: 'New note',
      content: '',
      updatedAt: null,
    };
  }

  return {
    title: localStorage.getItem(QUICK_NOTE_TITLE_KEY) || 'New note',
    content: localStorage.getItem(QUICK_NOTE_CONTENT_KEY) || '',
    updatedAt: readStoredTimestamp(localStorage.getItem(QUICK_NOTE_UPDATED_KEY)),
  };
}

export function saveQuickNoteDraft(title: string, content: string): QuickNoteDraft {
  const normalizedTitle = title.trim() || 'New note';
  const updatedAt = Date.now();

  if (typeof window !== 'undefined') {
    localStorage.setItem(QUICK_NOTE_TITLE_KEY, normalizedTitle);
    localStorage.setItem(QUICK_NOTE_CONTENT_KEY, content);
    localStorage.setItem(QUICK_NOTE_UPDATED_KEY, String(updatedAt));
  }

  return {
    title: normalizedTitle,
    content,
    updatedAt,
  };
}

export function clearQuickNoteDraft() {
  if (typeof window === 'undefined') return;

  localStorage.removeItem(QUICK_NOTE_TITLE_KEY);
  localStorage.removeItem(QUICK_NOTE_CONTENT_KEY);
  localStorage.removeItem(QUICK_NOTE_UPDATED_KEY);
}

function readStoredTimestamp(value: string | null) {
  if (!value) return null;

  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
