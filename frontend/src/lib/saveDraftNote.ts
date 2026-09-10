import { meetnolaInvoke } from '@/meetnola/ipc';
import { beginQuickNoteSave, clearQuickNoteDraft } from '@/lib/quickNoteDraft';
import { plainTextToBlocks } from '@/lib/meetingNotes';

export async function saveDraftNote(title: string, content: string, folderId: string | null) {
  // Persist the immutable submission ID before IPC, including across quit/reopen.
  const draft = beginQuickNoteSave(title, content, folderId);
  const meetingId = await meetnolaInvoke<string>('create_note', {
    draftId: draft.saveId,
    title: draft.title,
    notesMarkdown: draft.content,
    notesJson: JSON.stringify(plainTextToBlocks(draft.content)),
    folderId: draft.folderId,
  });
  clearQuickNoteDraft(draft.saveId!);
  return { meetingId, folderId: draft.folderId };
}
