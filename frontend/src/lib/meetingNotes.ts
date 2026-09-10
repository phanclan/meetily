import type { Block } from '@blocknote/core';

type BlockLike = {
  id?: string;
  type?: string;
  content?: unknown;
  children?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeInlineContent(content: unknown): unknown[] | undefined {
  if (!Array.isArray(content)) return undefined;

  return content.filter(item => {
    if (typeof item === 'string') return true;
    if (!isObject(item)) return false;
    return typeof item.type === 'string';
  });
}

function normalizeBlock(input: unknown): Block | null {
  if (!isObject(input)) return null;

  const block = input as BlockLike;
  if (typeof block.type !== 'string') return null;

  const normalizedChildren = Array.isArray(block.children)
    ? block.children
        .map(child => normalizeBlock(child))
        .filter((child): child is Block => child !== null)
    : undefined;

  const normalizedBlock: Record<string, unknown> = {
    ...block,
  };

  const normalizedContent = normalizeInlineContent(block.content);
  if (normalizedContent) {
    normalizedBlock.content = normalizedContent;
  }

  if (normalizedChildren) {
    normalizedBlock.children = normalizedChildren;
  }

  return normalizedBlock as Block;
}

export function normalizeBlockNoteBlocks(input: unknown): Block[] {
  if (!Array.isArray(input)) return [];

  return input
    .map(item => normalizeBlock(item))
    .filter((block): block is Block => block !== null);
}

function extractTextFromInline(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map(item => {
      if (typeof item === 'string') return item;
      if (!isObject(item)) return '';
      if (typeof item.text === 'string') return item.text;
      if (Array.isArray(item.content)) return extractTextFromInline(item.content);
      return '';
    })
    .join('');
}

function extractTextFromBlock(block: Block, lines: string[]) {
  const text = extractTextFromInline(block.content).trim();
  if (text) {
    lines.push(block.type === 'checkListItem' ? `- [${block.props?.checked ? 'x' : ' '}] ${text}` : text);
  }

  if (Array.isArray(block.children)) {
    block.children.forEach(child => extractTextFromBlock(child, lines));
  }
}

export function blocksToPlainText(blocks: Block[]): string {
  const lines: string[] = [];
  blocks.forEach(block => extractTextFromBlock(block, lines));
  return lines.join('\n').trim();
}

export function parseStoredMeetingNotesJson(input: string | null | undefined): Block[] {
  if (!input) return [];

  try {
    const parsed = JSON.parse(input);
    return normalizeBlockNoteBlocks(parsed);
  } catch {
    return [];
  }
}

function createParagraphBlock(text: string): Block {
  return {
    id: crypto.randomUUID(),
    type: 'paragraph',
    content: text
      ? [{ type: 'text', text, styles: {} }]
      : [],
  } as Block;
}

export function plainTextToBlocks(input: string): Block[] {
  const normalized = input
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);

  if (normalized.length === 0) {
    return [];
  }

  let fence: { marker: string; length: number } | null = null;
  return normalized.map(line => {
    // Examples inside Markdown fences must not become real follow-ups.
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.marker
        && delimiter[1].length >= fence.length && !delimiter[2].trim()) {
        fence = null;
      }
      return createParagraphBlock(line);
    }
    if (delimiter && (delimiter[1][0] !== '`' || !delimiter[2].includes('`'))) {
      fence = { marker: delimiter[1][0], length: delimiter[1].length };
      return createParagraphBlock(line);
    }

    const task = /^ {0,3}[-+*] +\[([ xX])\] +(\S.*)$/.exec(line);
    if (!task) return createParagraphBlock(line);

    return {
      ...createParagraphBlock(task[2]),
      type: 'checkListItem',
      props: { checked: task[1].toLowerCase() === 'x' },
    } as Block;
  });
}
