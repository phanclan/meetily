import type { Block } from '@blocknote/core';
import { getMeetingNotes, meetnolaInvoke } from '@/meetnola/ipc';
import { blocksToPlainText } from '@/lib/meetingNotes';
import { createWriteQueue } from '@/lib/pendingWrites';

export interface NoteTask {
  meetingId: string; title: string; createdAt: string; revision: string;
  blockId: string; text: string; checked: boolean;
}
export interface NoteTaskPage { tasks: NoteTask[]; hasMore: boolean }

export async function setNoteTaskChecked(task: NoteTask, checked: boolean): Promise<void> {
  await createWriteQueue(`notes:${task.meetingId}`).flush();
  const source = await getMeetingNotes<{ notes_json: string | null; updated_at: string } | null>(task.meetingId);
  if (!source?.notes_json || source.updated_at !== task.revision) throw new Error('The source note changed or is unavailable. Refresh follow-ups before trying again.');
  const blocks: Block[] = JSON.parse(source.notes_json);
  if (!Array.isArray(blocks)) throw new Error('The source note could not be read.');
  const matches: Block[] = [];
  const visit = (items: Block[]) => items.forEach(block => {
    if (!block || typeof block !== 'object') return;
    if (block.id === task.blockId) matches.push(block);
    if (Array.isArray(block.children)) visit(block.children);
  });
  visit(blocks);
  const block = matches[0];
  if (matches.length !== 1 || block.type !== 'checkListItem' || Boolean(block.props?.checked) !== task.checked) throw new Error('This checkbox changed. Refresh follow-ups before trying again.');
  block.props = { ...block.props, checked };
  // A compare-and-save prevents a concurrent edit after the read from being lost.
  // Conflicts are not put into the general retry queue, which would block Quit.
  await meetnolaInvoke('save_meeting_notes_if_unchanged', {
    meetingId: task.meetingId, expectedNotesJson: source.notes_json,
    notesJson: JSON.stringify(blocks), notesMarkdown: blocksToPlainText(blocks),
  });
}
