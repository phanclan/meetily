import { useState, useEffect, useRef, useCallback } from 'react';
import { getMeetingNotes, saveMeetingNotes } from '@/meetnola/ipc';
import type { Block } from '@blocknote/core';
import { blocksToPlainText, parseStoredMeetingNotesJson, plainTextToBlocks } from '@/lib/meetingNotes';

import { isLiveMeetingId, readLiveMeetingNotes, writeLiveMeetingNotes } from '@/lib/liveMeetingNotes';
import { toast } from 'sonner';
import { createWriteQueue, registerBeforeQuit } from '@/lib/pendingWrites';

const DEBOUNCE_MS = 2000;

function isPersistedMeetingId(meetingId: string | null) {
  return Boolean(meetingId && !isLiveMeetingId(meetingId));
}

export function useMeetingNotes(meetingId: string | null) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestBlocksRef = useRef<Block[]>([]);
  const hasPendingSaveRef = useRef(false);

  const flushSave = useCallback(async (
    blocksToSave: Block[],
    meetingIdToSave: string,
    trackState = true,
  ) => {
    if (!isPersistedMeetingId(meetingIdToSave)) {
      writeLiveMeetingNotes(meetingIdToSave, blocksToSave);
      return;
    }

    if (trackState) {
      setIsSaving(true);
    }
    try {
      await createWriteQueue(`notes:${meetingIdToSave}`).enqueue(async () => {
        await saveMeetingNotes({
          meetingId: meetingIdToSave,
          notesMarkdown: blocksToPlainText(blocksToSave),
          notesJson: JSON.stringify(blocksToSave),
        });
        if (latestBlocksRef.current === blocksToSave) {
          hasPendingSaveRef.current = false;
          setSaveError(false);
        }
      });
    } catch (err) {
      console.error('Failed to save notes:', err);
      setSaveError(true);
      toast.error('Notes could not be saved. Please retry before leaving.');
      throw err;
    } finally {
      if (latestBlocksRef.current === blocksToSave) {
        setIsSaving(false);
      }
    }
  }, []);

  // Load existing notes when meetingId becomes available
  useEffect(() => {
    setSaveError(false);
    setIsSaving(false);
    if (!meetingId) {
      setBlocks([]);
      setIsReady(false);
      latestBlocksRef.current = [];
      hasPendingSaveRef.current = false;
      return;
    }

    if (!isPersistedMeetingId(meetingId)) {
      const restored = readLiveMeetingNotes(meetingId) ?? [];
      setBlocks(restored);
      latestBlocksRef.current = restored;
      setIsReady(true);
      hasPendingSaveRef.current = false;
      return;
    }

    let cancelled = false;
    setBlocks([]);
    setIsReady(false);
    latestBlocksRef.current = [];
    hasPendingSaveRef.current = false;
    getMeetingNotes<{ notes_json?: string | null; notes_markdown?: string | null } | null>(meetingId)
      .then(result => {
        if (cancelled) return;

        const parsedBlocks = parseStoredMeetingNotesJson(result?.notes_json);
        const restored = parsedBlocks.length ? parsedBlocks : plainTextToBlocks(result?.notes_markdown || '');
        setBlocks(restored);
        latestBlocksRef.current = restored;
        setIsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Could not load saved notes. Reopen this meeting to retry.');
        setIsReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const queueSave = useCallback(
    (updatedBlocks: Block[], immediate = false) => {
      if (!meetingId) return;

      setBlocks(updatedBlocks);
      latestBlocksRef.current = updatedBlocks;
      if (isLiveMeetingId(meetingId)) {
        writeLiveMeetingNotes(meetingId, updatedBlocks);
        return;
      }

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      hasPendingSaveRef.current = true;
      setIsSaving(true);
      if (immediate) {
        void flushSave(updatedBlocks, meetingId).catch(() => {});
        return;
      }

      debounceRef.current = setTimeout(async () => {
        debounceRef.current = null;
        await flushSave(updatedBlocks, meetingId).catch(() => {});
      }, DEBOUNCE_MS);
    },
    [flushSave, meetingId],
  );

  const saveNotes = useCallback(
    (updatedBlocks: Block[]) => {
      queueSave(updatedBlocks, false);
    },
    [queueSave],
  );

  const replaceNotes = useCallback(
    (updatedBlocks: Block[], options?: { immediate?: boolean }) => {
      queueSave(updatedBlocks, options?.immediate === true);
    },
    [queueSave],
  );

  const flushPendingSave = useCallback(async (trackState = false) => {
    if (!meetingId || !hasPendingSaveRef.current) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    await flushSave(latestBlocksRef.current, meetingId, trackState);
  }, [flushSave, meetingId]);

  useEffect(() => registerBeforeQuit(() => flushPendingSave(true)), [flushPendingSave]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (meetingId && hasPendingSaveRef.current) {
        void flushSave(latestBlocksRef.current, meetingId, false).catch(() => {});
      }
    };
  }, [flushSave, meetingId]);

  return { blocks, saveNotes, replaceNotes, flushPendingSave, isSaving, isReady, saveError };
}
