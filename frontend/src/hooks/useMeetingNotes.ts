import { useState, useEffect, useRef, useCallback } from 'react';
import { getMeetingNotes, saveMeetingNotes } from '@/meetnola/ipc';
import type { Block } from '@blocknote/core';
import { blocksToPlainText, parseStoredMeetingNotesJson } from '@/lib/meetingNotes';

const DEBOUNCE_MS = 2000;

function isPersistedMeetingId(meetingId: string | null) {
  return Boolean(meetingId && !meetingId.startsWith('session-'));
}

export function useMeetingNotes(meetingId: string | null) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestBlocksRef = useRef<Block[]>([]);
  const hasPendingSaveRef = useRef(false);

  const flushSave = useCallback(async (
    blocksToSave: Block[],
    meetingIdToSave: string,
    trackState = true,
  ) => {
    if (!isPersistedMeetingId(meetingIdToSave)) {
      return;
    }

    if (trackState) {
      setIsSaving(true);
    }
    try {
      await saveMeetingNotes({
        meetingId: meetingIdToSave,
        notesMarkdown: blocksToPlainText(blocksToSave),
        notesJson: JSON.stringify(blocksToSave),
      });
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      if (trackState) {
        setIsSaving(false);
      }
    }
  }, []);

  // Load existing notes when meetingId becomes available
  useEffect(() => {
    if (!meetingId) {
      setBlocks([]);
      setIsReady(false);
      latestBlocksRef.current = [];
      hasPendingSaveRef.current = false;
      return;
    }

    if (!isPersistedMeetingId(meetingId)) {
      setIsReady(true);
      hasPendingSaveRef.current = false;
      return;
    }

    let cancelled = false;
    setBlocks([]);
    setIsReady(false);
    latestBlocksRef.current = [];
    hasPendingSaveRef.current = false;
    getMeetingNotes<{ notes_json?: string | null } | null>(meetingId)
      .then(result => {
        if (cancelled) return;

        if (result?.notes_json) {
          const parsedBlocks = parseStoredMeetingNotesJson(result.notes_json);
          setBlocks(parsedBlocks);
          latestBlocksRef.current = parsedBlocks;
        }
        setIsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setBlocks([]);
        setIsReady(true);
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

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (immediate) {
        hasPendingSaveRef.current = false;
        void flushSave(updatedBlocks, meetingId);
        return;
      }

      hasPendingSaveRef.current = true;
      debounceRef.current = setTimeout(async () => {
        await flushSave(updatedBlocks, meetingId);
        debounceRef.current = null;
        hasPendingSaveRef.current = false;
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
    if (!meetingId) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    hasPendingSaveRef.current = false;
    await flushSave(latestBlocksRef.current, meetingId, trackState);
  }, [flushSave, meetingId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (meetingId && hasPendingSaveRef.current) {
        void flushSave(latestBlocksRef.current, meetingId, false);
      }
    };
  }, [flushSave, meetingId]);

  return { blocks, saveNotes, replaceNotes, flushPendingSave, isSaving, isReady };
}
