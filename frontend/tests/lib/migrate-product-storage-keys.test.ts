import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateProductStorageKeys } from '../../src/lib/migrateProductStorageKeys';

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('migrateProductStorageKeys', () => {
  test('renames exact Meetily and Meetnola keys once', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem('meetily.callDetectionEnabled', 'false');
    local.setItem('meetily.quick_note.content', 'Draft');
    local.setItem('meetnola.live-notes.meeting-1', '[]');
    session.setItem('meetnola.recording.note-folder', 'folder-9');

    migrateProductStorageKeys(local, session);
    migrateProductStorageKeys(local, session);

    assert.equal(local.getItem('afterword.callDetectionEnabled'), 'false');
    assert.equal(local.getItem('afterword.quick_note.content'), 'Draft');
    assert.equal(local.getItem('afterword.live-notes.meeting-1'), '[]');
    assert.equal(session.getItem('afterword.recording.note-folder'), 'folder-9');
    assert.equal(local.getItem('meetily.callDetectionEnabled'), null);
    assert.equal(local.getItem('meetnola.live-notes.meeting-1'), null);
    assert.equal(local.getItem('afterword.identity-migrated'), '1');
  });

  test('does not overwrite a newer Afterword key', () => {
    const local = new MemoryStorage();
    local.setItem('meetily.callDetectionEnabled', 'false');
    local.setItem('afterword.callDetectionEnabled', 'true');

    migrateProductStorageKeys(local, null);

    assert.equal(local.getItem('afterword.callDetectionEnabled'), 'true');
    assert.equal(local.getItem('meetily.callDetectionEnabled'), null);
  });
});
