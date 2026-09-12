import { useCallback, useEffect, useRef, useState } from 'react';
import { afterwordInvoke } from '@/afterword/ipc';
import { setNoteTaskChecked, type NoteTask, type NoteTaskPage } from '@/lib/noteTasks';

export function useNoteTasks(checked: boolean, folderId: string) {
  const [tasks, setTasks] = useState<NoteTask[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const request = useRef(0);
  const reading = useRef(false);
  const writing = useRef(false);
  const load = useCallback(async (offset = 0) => {
    if (offset && reading.current) return;
    const token = ++request.current;
    reading.current = true; setLoading(true); setError(null);
    try {
      const result = await afterwordInvoke<NoteTaskPage>('list_note_tasks', { checked, folderId: folderId || null, offset });
      if (token !== request.current) return;
      setTasks(previous => offset ? [...previous, ...result.tasks] : result.tasks);
      setHasMore(result.hasMore);
    } catch (error) { if (token === request.current) setError(String(error)); }
    finally { if (token === request.current) { reading.current = false; setLoading(false); } }
  }, [checked, folderId]);
  useEffect(() => {
    setTasks([]); setHasMore(false); void load();
    return () => { request.current++; reading.current = false; };
  }, [load]);
  const toggle = async (task: NoteTask) => {
    if (writing.current || reading.current) return false;
    writing.current = true; setSaving(true); setError(null);
    const token = request.current;
    try {
      await setNoteTaskChecked(task, !task.checked);
      if (token !== request.current) return false;
      setTasks(items => items.map(item => item.meetingId === task.meetingId && item.blockId === task.blockId ? { ...item, checked: !task.checked } : item));
      await load();
      return true;
    } catch (error) { if (token === request.current) setError(String(error)); return false; }
    finally { writing.current = false; setSaving(false); }
  };
  return { tasks, hasMore, loading, error, saving, toggle, refresh: () => load(), loadMore: () => load(tasks.length) };
}
