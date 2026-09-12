import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePersistentChat } from './useSavedMeetingChat';
import { afterwordInvoke } from '@/afterword/ipc';
import { createWriteQueue, registerBeforeQuit } from '@/lib/pendingWrites';
import type { LibraryPeriod, LibrarySourceScope } from '@/lib/libraryAnswerContext';

interface Settings { draft: string; period: LibraryPeriod; sourceScope: LibrarySourceScope; archived: boolean }
const defaults: Settings = { draft: '', period: 'all', sourceScope: 'keywords', archived: false };

/** Messages and draft/settings use separate queues, so neither can overwrite the other. */
export function useLibraryChat(chatId: string) {
  const chat = usePersistentChat(chatId, 'library');
  const [settings, setSettings] = useState<Settings>(defaults);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const queue = useMemo(() => createWriteQueue(`library-draft:${chatId}`), [chatId]);
  const owner = useRef(chatId);
  owner.current = chatId;
  const latest = useRef<{ id: string; settings: Settings } | null>(null);
  if (loadedFor === chatId) latest.current = { id: chatId, settings };
  const saved = useRef('');
  const flushSettings = useCallback(async () => {
    const snapshot = latest.current;
    if (snapshot?.id !== chatId || snapshot.settings.archived) return;
    const { draft, period, sourceScope } = snapshot.settings;
    const signature = JSON.stringify({ draft, period, sourceScope });
    if (signature === saved.current) return queue.flush();
    if (owner.current === chatId) setSaving(true);
    try {
      await queue.enqueue(() => afterwordInvoke<void>('save_library_chat_settings', { chatId, draft, period, sourceScope }));
      if (owner.current === chatId) { saved.current = signature; setSettingsError(null); }
    } catch (error) {
      if (owner.current === chatId) setSettingsError(`Draft not saved: ${String(error)}`);
      throw error;
    } finally { if (owner.current === chatId) setSaving(false); }
  }, [chatId, queue]);

  useEffect(() => {
    let cancelled = false;
    setLoadedFor(null);
    setSettingsError(null);
    void (async () => {
      try {
        await queue.flush();
        const result = await afterwordInvoke<Settings>('get_library_chat_settings', { chatId });
        if (cancelled || owner.current !== chatId) return;
        if (typeof result.draft !== 'string' || !['all', '7', '30', '90'].includes(result.period) || typeof result.archived !== 'boolean' || !['keywords', 'recent'].includes(result.sourceScope)) throw new Error('Invalid saved conversation settings');
        saved.current = JSON.stringify({ draft: result.draft, period: result.period, sourceScope: result.sourceScope });
        setSettings(result);
        setLoadedFor(chatId);
      } catch (error) { if (!cancelled && owner.current === chatId) setSettingsError(String(error)); }
    })();
    return () => { cancelled = true; void flushSettings().catch(() => {}); };
  }, [chatId, queue, flushSettings, reload]);
  useEffect(() => registerBeforeQuit(flushSettings), [flushSettings]);
  useEffect(() => {
    if (loadedFor !== chatId || settings.archived) return;
    const timer = setTimeout(() => { void flushSettings().catch(() => {}); }, 350);
    return () => clearTimeout(timer);
  }, [chatId, loadedFor, settings, flushSettings]);

  const ready = chat.ready && loadedFor === chatId;
  const updateSettings = (patch: Partial<Settings>) => {
    if (!ready || settings.archived) return;
    const value = { ...settings, ...patch };
    latest.current = { id: chatId, settings: value };
    setSettings(value);
  };
  return { ...chat, ready, settings, saving, settingsError,
    setInput: (draft: string) => updateSettings({ draft }),
    setPeriod: (period: LibraryPeriod) => updateSettings({ period }),
    setSourceScope: (sourceScope: LibrarySourceScope) => updateSettings({ sourceScope }),
    retrySettings: () => { if (loadedFor !== chatId) setReload(value => value + 1); else void flushSettings().catch(() => {}); },
    reloadSettings: () => setReload(value => value + 1),
    flush: async () => { await flushSettings(); await chat.flushHistory(); },
  };
}
