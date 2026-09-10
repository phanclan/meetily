export const MAX_NOTE_MATCHES = 1000;

/** Literal, case-insensitive matching with offsets in the original UTF-16 text. */
export function noteMatchOffsets(text: string, query: string, limit = MAX_NOTE_MATCHES + 1) {
  if (!query.trim()) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(pattern)) {
    matches.push({ start: match.index!, end: match.index! + match[0].length });
    if (matches.length >= limit) break;
  }
  return matches;
}

/** Read editor text without inserting marks into BlockNote's managed document. */
export function findNoteRanges(root: HTMLElement, query: string) {
  const ranges: Range[] = [];
  if (!query.trim()) return { ranges, truncated: false };
  const document = root.ownerDocument;
  const groups = new Map<Element, Text[]>();
  for (const editor of root.querySelectorAll<HTMLElement>('.document-editor')) {
    if (editor.closest('[hidden]') || getComputedStyle(editor).display === 'none') continue;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('[hidden], [aria-hidden="true"], button, [role="button"], script, style')) continue;
      const block = parent.closest('.bn-inline-content, p, h1, h2, h3, h4, h5, h6, li, pre, td, th') || editor;
      const texts = groups.get(block) || [];
      texts.push(node as Text);
      groups.set(block, texts);
    }
  }
  for (const nodes of groups.values()) {
    const text = nodes.map(node => node.data).join('');
    for (const match of noteMatchOffsets(text, query, MAX_NOTE_MATCHES + 1 - ranges.length)) {
      if (ranges.length === MAX_NOTE_MATCHES) return { ranges, truncated: true };
      const range = document.createRange();
      let offset = 0;
      let started = false;
      for (const node of nodes) {
        const end = offset + node.length;
        if (!started && match.start < end) {
          range.setStart(node, match.start - offset);
          started = true;
        }
        if (started && match.end <= end) {
          range.setEnd(node, match.end - offset);
          break;
        }
        offset = end;
      }
      ranges.push(range);
    }
  }
  return { ranges, truncated: false };
}
