export const ASK_QUERY = 'ask';
export const ASK_CHAT_QUERY = 'chat';

export function validLibraryChatId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function searchParamsFrom(search: string) {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

export function isAskPath(pathname: string) {
  return pathname === '/ask';
}

export function isHomeAskOpen(pathname: string, search: string) {
  if (isAskPath(pathname)) return true;
  if (pathname !== '/') return false;
  return searchParamsFrom(search).get(ASK_QUERY) === '1';
}

export function homeAskPath(search: string, chatId?: string | null) {
  const params = searchParamsFrom(search);
  params.set(ASK_QUERY, '1');
  if (chatId) {
    if (validLibraryChatId(chatId)) params.set(ASK_CHAT_QUERY, chatId);
    else params.delete(ASK_CHAT_QUERY);
  }
  return `/?${params.toString()}`;
}

export function homePathWithoutAsk(search: string) {
  const params = searchParamsFrom(search);
  params.delete(ASK_QUERY);
  params.delete(ASK_CHAT_QUERY);
  const value = params.toString();
  return value ? `/?${value}` : '/';
}

/** Legacy `/ask` bookmark. Redirects to Home dock Ask, preserving a valid chat id. */
export function homeAskFromAskPage(search: string) {
  return homeAskPath('', searchParamsFrom(search).get(ASK_CHAT_QUERY));
}

export type HomeLibraryPathUpdates = {
  view?: 'all' | null;
  folder?: string | null;
  q?: string | null;
};

/**
 * Home library URL that can change `view` / `folder` / `q` without dropping Ask.
 * Only Home library + Ask keys are emitted, so Follow-ups `status` cannot leak onto `/`.
 */
export function homeLibraryPath(search: string, updates: HomeLibraryPathUpdates = {}) {
  const current = searchParamsFrom(search);
  const params = new URLSearchParams();
  const view = 'view' in updates ? updates.view : current.get('view');
  const folder = 'folder' in updates ? updates.folder : current.get('folder');
  const q = 'q' in updates ? updates.q : current.get('q');

  if (view === 'all') params.set('view', 'all');
  if (folder) params.set('folder', folder);
  if (q) params.set('q', q);

  if (current.get(ASK_QUERY) === '1') {
    params.set(ASK_QUERY, '1');
    const chat = current.get(ASK_CHAT_QUERY);
    if (chat && validLibraryChatId(chat)) params.set(ASK_CHAT_QUERY, chat);
  }

  const value = params.toString();
  return value ? `/?${value}` : '/';
}

export function askPagePath(chatId?: string | null) {
  if (chatId && validLibraryChatId(chatId)) return `/ask?${ASK_CHAT_QUERY}=${encodeURIComponent(chatId)}`;
  return '/ask';
}
