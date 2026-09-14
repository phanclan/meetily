const MIGRATED_FLAG = 'afterword.identity-migrated';

const EXACT_KEYS: Array<[string, string]> = [
  ['meetily.callDetectionEnabled', 'afterword.callDetectionEnabled'],
  ['meetily.quick_note.title', 'afterword.quick_note.title'],
  ['meetily.quick_note.content', 'afterword.quick_note.content'],
  ['meetily.quick_note.updated_at', 'afterword.quick_note.updated_at'],
  ['meetily.quick_note.folder_id', 'afterword.quick_note.folder_id'],
  ['meetily.quick_note.save_id', 'afterword.quick_note.save_id'],
  ['meetily:console-bridge', 'afterword:console-bridge'],
  ['meetnola.recording.note-folder', 'afterword.recording.note-folder'],
];

const PREFIXES: Array<[string, string]> = [
  ['meetnola.live-notes.', 'afterword.live-notes.'],
  ['meetnola.live-folder.', 'afterword.live-folder.'],
];

type KeyStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

function moveKey(storage: KeyStorage, from: string, to: string) {
  if (from === to) return;
  const incoming = storage.getItem(from);
  if (incoming == null) return;
  if (storage.getItem(to) == null) {
    storage.setItem(to, incoming);
  }
  storage.removeItem(from);
}

function movePrefixedKeys(storage: KeyStorage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    for (const [fromPrefix, toPrefix] of PREFIXES) {
      if (key.startsWith(fromPrefix)) {
        moveKey(storage, key, `${toPrefix}${key.slice(fromPrefix.length)}`);
      }
    }
  }
}

/**
 * One-shot rename of Meetily/Meetnola webview keys onto Afterword names.
 * Does not keep reading the old keys after this runs.
 */
export function migrateProductStorageKeys(
  storage?: KeyStorage | null,
  session?: KeyStorage | null,
) {
  const local =
    storage ??
    (typeof window === 'undefined' ? null : window.localStorage);
  if (!local || local.getItem(MIGRATED_FLAG) === '1') return;

  for (const [from, to] of EXACT_KEYS) {
    moveKey(local, from, to);
  }
  movePrefixedKeys(local);

  const sessionStore =
    session === undefined
      ? typeof window === 'undefined'
        ? null
        : window.sessionStorage
      : session;
  if (sessionStore) {
    moveKey(
      sessionStore,
      'meetnola.recording.note-folder',
      'afterword.recording.note-folder',
    );
  }

  local.setItem(MIGRATED_FLAG, '1');
}

if (typeof window !== 'undefined') {
  migrateProductStorageKeys();
}
