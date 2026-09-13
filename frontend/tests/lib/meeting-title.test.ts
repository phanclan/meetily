import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTitleFromText,
  isGeneratedMeetingTitle,
  isPlaceholderMeetingTitle,
  resolvePersistedMeetingTitle,
  resolveSeededMeetingTitle,
  shouldPersistTitleOnAppend,
} from '../../src/lib/meetingTitle';

describe('meetingTitle placeholders', () => {
  test('detects current and legacy generated titles', () => {
    assert.equal(isGeneratedMeetingTitle('Meeting 12_09_26_23_04_55'), true);
    assert.equal(isGeneratedMeetingTitle('Meeting 2026-09-12_23-04-55'), true);
    assert.equal(isGeneratedMeetingTitle('Project sync'), false);
  });

  test('treats New note and Untitled as placeholders', () => {
    assert.equal(isPlaceholderMeetingTitle('New note'), true);
    assert.equal(isPlaceholderMeetingTitle('+ New Call'), true);
    assert.equal(isPlaceholderMeetingTitle('Untitled'), true);
    assert.equal(isPlaceholderMeetingTitle('Q3 planning'), false);
  });

  test('draft New note does not override generated session title', () => {
    assert.equal(
      resolveSeededMeetingTitle('New note', 'Meeting 12_09_26_23_04_55'),
      'Meeting 12_09_26_23_04_55',
    );
    assert.equal(
      resolveSeededMeetingTitle('Custom title', 'Meeting 12_09_26_23_04_55'),
      'Custom title',
    );
    assert.equal(resolveSeededMeetingTitle('New note', ''), 'New note');
    assert.equal(
      resolveSeededMeetingTitle('New note', 'Meeting 2026-09-12_23-04-55'),
      'Meeting 2026-09-12_23-04-55',
    );
  });

  test('derives a short title from transcript or notes text', () => {
    assert.equal(
      deriveTitleFromText('## Weekly planning sync\nMore notes'),
      'Weekly planning sync',
    );
    assert.equal(deriveTitleFromText('ok\n'), null);
    assert.equal(
      deriveTitleFromText('We should ship the title fix this week.'),
      'We should ship the title fix this week.',
    );
  });

  test('persisted title keeps generated and derives only for named placeholders', () => {
    assert.equal(
      resolvePersistedMeetingTitle({
        uiTitle: 'New note',
        savedMeetingName: 'Meeting 12_09_26_23_04_55',
        sourceText: 'Ignore me because timestamp wins',
      }),
      'Meeting 12_09_26_23_04_55',
    );
    assert.equal(
      resolvePersistedMeetingTitle({
        uiTitle: 'New note',
        savedMeetingName: 'New note',
        sourceText: 'Roadmap review with design\nNext steps',
      }),
      'Roadmap review with design',
    );
    assert.equal(
      resolvePersistedMeetingTitle({
        uiTitle: 'Custom title',
        sourceText: 'Should not replace custom',
      }),
      'Custom title',
    );
  });
});

  test('always saves non-placeholder title on append when DB still has placeholder', () => {
    assert.equal(
      shouldPersistTitleOnAppend({
        persistedTitle: 'Meeting 12_09_26_23_04_55',
        databaseTitle: 'New note',
      }),
      true,
    );
    assert.equal(
      shouldPersistTitleOnAppend({
        persistedTitle: 'Meeting 12_09_26_23_04_55',
        databaseTitle: 'Meeting 12_09_26_23_04_55',
      }),
      false,
    );
    assert.equal(
      shouldPersistTitleOnAppend({
        persistedTitle: 'New note',
        databaseTitle: 'New note',
      }),
      false,
    );
    assert.equal(
      shouldPersistTitleOnAppend({
        persistedTitle: 'Weekly sync',
        databaseTitle: null,
      }),
      true,
    );
  });

