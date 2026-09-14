import { migrateProductStorageKeys } from '@/lib/migrateProductStorageKeys';

export interface QuickNoteDraft {
  title: string;
  content: string;
  updatedAt: number | null;
  folderId: string | null;
  saveId: string | null;
}

const QUICK_NOTE_TITLE_KEY = 'afterword.quick_note.title';
const QUICK_NOTE_CONTENT_KEY = 'afterword.quick_note.content';
const QUICK_NOTE_UPDATED_KEY = 'afterword.quick_note.updated_at';
const QUICK_NOTE_FOLDER_KEY = 'afterword.quick_note.folder_id';
const QUICK_NOTE_SAVE_KEY = 'afterword.quick_note.save_id';

export function loadQuickNoteDraft(): QuickNoteDraft {
  if (typeof window === 'undefined') {
    return {
      title: 'New note',
      content: '',
      updatedAt: null,
      folderId: null,
      saveId: null,
    };
  }

  migrateProductStorageKeys();

  return {
    title: localStorage.getItem(QUICK_NOTE_TITLE_KEY) || 'New note',
    content: localStorage.getItem(QUICK_NOTE_CONTENT_KEY) || '',
    updatedAt: readStoredTimestamp(localStorage.getItem(QUICK_NOTE_UPDATED_KEY)),
    folderId: localStorage.getItem(QUICK_NOTE_FOLDER_KEY) || null,
    saveId: localStorage.getItem(QUICK_NOTE_SAVE_KEY) || null,
  };
}

// Reopening a draft from a different folder must not silently move existing work.
export function loadQuickNoteDraftForFolder(folderId: string | null): QuickNoteDraft {
  const draft = loadQuickNoteDraft();
  return draft.content.trim() || draft.title !== 'New note' || draft.folderId
    ? draft
    : { ...draft, folderId };
}

export function saveQuickNoteDraft(title: string, content: string, folderId = loadQuickNoteDraft().folderId): QuickNoteDraft {
  const pending = loadQuickNoteDraft();
  if (pending.saveId) return pending;
  const normalizedTitle = title.trim() || 'New note';
  const updatedAt = Date.now();

  if (typeof window !== 'undefined') {
    localStorage.setItem(QUICK_NOTE_TITLE_KEY, normalizedTitle);
    localStorage.setItem(QUICK_NOTE_CONTENT_KEY, content);
    localStorage.setItem(QUICK_NOTE_UPDATED_KEY, String(updatedAt));
    if (folderId) localStorage.setItem(QUICK_NOTE_FOLDER_KEY, folderId);
    else localStorage.removeItem(QUICK_NOTE_FOLDER_KEY);
  }

  return {
    title: normalizedTitle,
    content,
    updatedAt,
    folderId,
    saveId: typeof window === 'undefined' ? null : localStorage.getItem(QUICK_NOTE_SAVE_KEY),
  };
}

export function beginQuickNoteSave(title: string, content: string, folderId: string | null): QuickNoteDraft {
  const pending = loadQuickNoteDraft();
  if (pending.saveId) return pending;
  if (!content.trim()) throw new Error('Write something before saving the note.');
  const draft = saveQuickNoteDraft(title, content, folderId);
  const saveId = crypto.randomUUID();
  localStorage.setItem(QUICK_NOTE_SAVE_KEY, saveId);
  return { ...draft, saveId };
}

export function clearQuickNoteDraft(expectedSaveId?: string) {
  if (typeof window === 'undefined') return;
  if (expectedSaveId && localStorage.getItem(QUICK_NOTE_SAVE_KEY) !== expectedSaveId) return;

  localStorage.removeItem(QUICK_NOTE_TITLE_KEY);
  localStorage.removeItem(QUICK_NOTE_CONTENT_KEY);
  localStorage.removeItem(QUICK_NOTE_UPDATED_KEY);
  localStorage.removeItem(QUICK_NOTE_FOLDER_KEY);
  localStorage.removeItem(QUICK_NOTE_SAVE_KEY);
}

function readStoredTimestamp(value: string | null) {
  if (!value) return null;

  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
