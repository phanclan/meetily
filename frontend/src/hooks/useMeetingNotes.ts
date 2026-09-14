import { useState, useEffect, useRef, useCallback } from 'react';
import { getMeetingNotes, saveMeetingNotes } from '@/afterword/ipc';
import type { Block } from '@blocknote/core';
import { blocksToPlainText, parseStoredMeetingNotesJson, plainTextToBlocks } from '@/lib/meetingNotes';

import { isLiveMeetingId, readLiveMeetingNotes, writeLiveMeetingNotes } from '@/lib/liveMeetingNotes';
import { isPersistedMeetingId } from '@/lib/recordingSessionIdentity';
import { toast } from 'sonner';
import { createWriteQueue, registerBeforeQuit } from '@/lib/pendingWrites';

const DEBOUNCE_MS = 2000;
/** Push typed blocks into React at most this often. The editor keeps its own document. */
const BLOCKS_UI_MS = 300;

/**
 * Persist notes for `notesOwnerId`. Callers must pass the resolved notes owner
 * (`resolveNotesOwnerId`), not a conflated live capture id, when those differ.
 */
export function useMeetingNotes(meetingId: string | null) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [contentEpoch, setContentEpoch] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadedFor = useRef<string | null>(null);
  const failedFor = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestBlocksRef = useRef<Block[]>([]);
  const hasPendingSaveRef = useRef(false);

  const bumpEpoch = useCallback(() => {
    setContentEpoch(value => value + 1);
  }, []);

  const scheduleBlocksUi = useCallback(() => {
    if (blocksUiTimerRef.current) return;
    blocksUiTimerRef.current = setTimeout(() => {
      blocksUiTimerRef.current = null;
      setBlocks(latestBlocksRef.current);
    }, BLOCKS_UI_MS);
  }, []);

  const applyAuthoritativeBlocks = useCallback((next: Block[]) => {
    if (blocksUiTimerRef.current) {
      clearTimeout(blocksUiTimerRef.current);
      blocksUiTimerRef.current = null;
    }
    latestBlocksRef.current = next;
    setBlocks(next);
    bumpEpoch();
  }, [bumpEpoch]);

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
    loadedFor.current = null;
    failedFor.current = null;
    setLoadError(false);
    setSaveError(false);
    setIsSaving(false);
    if (!meetingId) {
      applyAuthoritativeBlocks([]);
      setIsReady(false);
      hasPendingSaveRef.current = false;
      return;
    }

    if (!isPersistedMeetingId(meetingId)) {
      const restored = readLiveMeetingNotes(meetingId) ?? [];
      applyAuthoritativeBlocks(restored);
      loadedFor.current = meetingId;
      setIsReady(true);
      hasPendingSaveRef.current = false;
      return;
    }

    let cancelled = false;
    applyAuthoritativeBlocks([]);
    setIsReady(false);
    hasPendingSaveRef.current = false;
    getMeetingNotes<{ notes_json?: string | null; notes_markdown?: string | null } | null>(meetingId)
      .then(result => {
        if (cancelled) return;

        const parsedBlocks = parseStoredMeetingNotesJson(result?.notes_json);
        const restored = parsedBlocks.length ? parsedBlocks : plainTextToBlocks(result?.notes_markdown || '');
        applyAuthoritativeBlocks(restored);
        loadedFor.current = meetingId;
        setIsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        failedFor.current = meetingId;
        setLoadError(true);
        toast.error('Could not load saved notes. Retry loading notes.');
        setIsReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId, loadAttempt, applyAuthoritativeBlocks]);

  // A load retry must never replace successfully loaded or locally edited notes.
  const retryLoad = useCallback(() => {
    if (!meetingId || failedFor.current !== meetingId || hasPendingSaveRef.current) return;
    failedFor.current = null;
    setLoadError(false);
    setLoadAttempt(attempt => attempt + 1);
  }, [meetingId]);

  const queueSave = useCallback(
    (updatedBlocks: Block[], options: { persistNow?: boolean; replaceDocument?: boolean } = {}) => {
      if (!meetingId) return;

      latestBlocksRef.current = updatedBlocks;
      if (options.replaceDocument) {
        applyAuthoritativeBlocks(updatedBlocks);
      } else {
        scheduleBlocksUi();
      }

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
      if (options.persistNow) {
        void flushSave(updatedBlocks, meetingId).catch(() => {});
        return;
      }

      debounceRef.current = setTimeout(async () => {
        debounceRef.current = null;
        await flushSave(updatedBlocks, meetingId).catch(() => {});
      }, DEBOUNCE_MS);
    },
    [applyAuthoritativeBlocks, flushSave, meetingId, scheduleBlocksUi],
  );

  const saveNotes = useCallback(
    (updatedBlocks: Block[]) => {
      queueSave(updatedBlocks);
    },
    [queueSave],
  );

  const replaceNotes = useCallback(
    (updatedBlocks: Block[], options?: { immediate?: boolean }) => {
      queueSave(updatedBlocks, {
        replaceDocument: true,
        persistNow: options?.immediate === true,
      });
    },
    [queueSave],
  );

  const getNoteText = useCallback(() => {
    return blocksToPlainText(latestBlocksRef.current);
  }, []);

  const flushPendingSave = useCallback(async (trackState = false) => {
    if (!meetingId || !hasPendingSaveRef.current) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (blocksUiTimerRef.current) {
      clearTimeout(blocksUiTimerRef.current);
      blocksUiTimerRef.current = null;
      setBlocks(latestBlocksRef.current);
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
      if (blocksUiTimerRef.current) {
        clearTimeout(blocksUiTimerRef.current);
        blocksUiTimerRef.current = null;
      }

      if (meetingId && hasPendingSaveRef.current) {
        void flushSave(latestBlocksRef.current, meetingId, false).catch(() => {});
      }
    };
  }, [flushSave, meetingId]);

  return {
    blocks,
    contentEpoch,
    blocksRef: latestBlocksRef,
    getNoteText,
    saveNotes,
    replaceNotes,
    flushPendingSave,
    isSaving,
    isReady: isReady && loadedFor.current === meetingId,
    saveError,
    loadError: loadError && failedFor.current === meetingId,
    retryLoad,
  };
}
