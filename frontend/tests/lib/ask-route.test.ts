import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askPagePath,
  homeAskFromAskPage,
  homeAskPath,
  homeLibraryPath,
  homePathWithoutAsk,
  isAskPath,
  isHomeAskOpen,
  validLibraryChatId,
} from '../../src/lib/askRoute';

const chat = '2c7b1d0a-4e8f-4a21-9c3d-7f6e5b4a3210';

describe('askRoute', () => {
  test('opens Ask on Home without dropping folder or search state', () => {
    assert.equal(homeAskPath('view=all&folder=work&q=alpha'), `/?view=all&folder=work&q=alpha&ask=1`);
    assert.equal(homeAskPath('view=all', chat), `/?view=all&ask=1&chat=${chat}`);
    assert.equal(homeAskPath(`view=all&ask=1&chat=${chat}`), `/?view=all&ask=1&chat=${chat}`);
    assert.equal(homePathWithoutAsk(`view=all&ask=1&chat=${chat}`), '/?view=all');
    assert.equal(homePathWithoutAsk('ask=1'), '/');
  });

  test('treats Home ask=1 and /ask as open Ask destinations', () => {
    assert.equal(isHomeAskOpen('/', 'ask=1'), true);
    assert.equal(isHomeAskOpen('/', 'view=all'), false);
    assert.equal(isHomeAskOpen('/ask', ''), true);
    assert.equal(isHomeAskOpen('/ask', `chat=${chat}`), true);
    assert.equal(isAskPath('/ask'), true);
    assert.equal(askPagePath(chat), `/ask?chat=${chat}`);
    assert.equal(validLibraryChatId(chat), true);
    assert.equal(validLibraryChatId('nope'), false);
  });

  test('maps /ask bookmarks onto Home dock Ask', () => {
    assert.equal(homeAskFromAskPage(''), '/?ask=1');
    assert.equal(homeAskFromAskPage(`chat=${chat}`), `/?ask=1&chat=${chat}`);
    assert.equal(homeAskFromAskPage('chat=not-a-uuid'), '/?ask=1');
    assert.equal(homeAskFromAskPage(askPagePath(chat).slice('/ask'.length)), `/?ask=1&chat=${chat}`);
  });

  test('preserves ask+chat across folder, view, and search mutations', () => {
    const open = `ask=1&chat=${chat}`;
    assert.equal(
      homeLibraryPath(open, { view: 'all', folder: 'work', q: 'alpha' }),
      `/?view=all&folder=work&q=alpha&ask=1&chat=${chat}`,
    );
    assert.equal(
      homeLibraryPath(`view=all&folder=work&q=alpha&${open}`, { view: null, folder: null, q: null }),
      `/?ask=1&chat=${chat}`,
    );
    assert.equal(
      homeLibraryPath(`view=all&${open}`, { q: 'beta' }),
      `/?view=all&q=beta&ask=1&chat=${chat}`,
    );
    assert.equal(
      homeLibraryPath(`view=all&folder=work&${open}`, { folder: null, q: null }),
      `/?view=all&ask=1&chat=${chat}`,
    );
  });

  test('library path does not leak Follow-ups status onto Home', () => {
    assert.equal(
      homeLibraryPath('folder=work&status=completed', { view: 'all', folder: 'work', q: null }),
      '/?view=all&folder=work',
    );
    assert.equal(
      homeLibraryPath('folder=work&status=completed', { view: null, folder: null, q: null }),
      '/',
    );
  });
});
