"use client";

import { useEffect, useRef } from "react";
import type { PartialBlock, Block } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import "@blocknote/core/fonts/inter.css";

interface EditorProps {
  initialContent?: Block[];
  onChange?: (blocks: Block[]) => void;
  editable?: boolean;
}

export default function Editor({ initialContent, onChange, editable = true }: EditorProps) {
  console.log('📝 EDITOR: Initializing BlockNote editor with blocks:', {
    hasContent: !!initialContent,
    blocksCount: initialContent?.length || 0,
    editable
  });

  const lastContentRef = useRef(initialContent);
  const replacingRef = useRef(false);
  const editor = useCreateBlockNote({
    initialContent: initialContent?.length ? initialContent as PartialBlock[] : undefined,
  });

  console.log('📝 EDITOR: BlockNote editor created successfully');

  // Parent replacements (such as Clear) must update the mounted editor too.
  useEffect(() => {
    if (initialContent === lastContentRef.current) return;
    lastContentRef.current = initialContent;
    if (JSON.stringify(initialContent) === JSON.stringify(editor.document)) return;
    replacingRef.current = true;
    try {
      editor.replaceBlocks(editor.document, initialContent?.length
        ? initialContent as PartialBlock[]
        : [{ type: "paragraph", content: [] }]);
    } finally {
      replacingRef.current = false;
    }
  }, [editor, initialContent]);

  // Handle content changes
  useEffect(() => {
    if (!onChange) return;

    const handleChange = () => {
      if (replacingRef.current) return;
      lastContentRef.current = editor.document;
      console.log('📝 EDITOR: Content changed, notifying parent...', {
        blocksCount: editor.document.length
      });
      onChange(editor.document);
    };

    const unsubscribe = editor.onChange(handleChange);

    return () => {
      if (typeof unsubscribe === 'function') {
        console.log('📝 EDITOR: Cleaning up onChange listener');
        unsubscribe();
      }
    };
  }, [editor, onChange]);

  return <BlockNoteView editor={editor} editable={editable} theme="light" />;
}
