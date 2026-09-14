"use client";

import { useEffect, useRef } from "react";
import type { PartialBlock, Block } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import "@blocknote/core/fonts/inter.css";

interface EditorProps {
  initialContent?: Block[];
  /**
   * Increment when the parent has a new authoritative document (load, clear,
   * restore). Typing must not change this, or the editor will replace its own
   * document on every keystroke.
   */
  contentEpoch?: number;
  onChange?: (blocks: Block[]) => void;
  editable?: boolean;
}

export default function Editor({
  initialContent,
  contentEpoch = 0,
  onChange,
  editable = true,
}: EditorProps) {
  const lastEpochRef = useRef(contentEpoch);
  const replacingRef = useRef(false);
  const editor = useCreateBlockNote({
    initialContent: initialContent?.length ? initialContent as PartialBlock[] : undefined,
  });

  // Parent replacements (load / clear / restore) must update the mounted editor.
  // Compare epoch, not document JSON — stringify of the full note on every parent
  // render is what made typing hitch.
  useEffect(() => {
    if (contentEpoch === lastEpochRef.current) return;
    lastEpochRef.current = contentEpoch;
    replacingRef.current = true;
    try {
      editor.replaceBlocks(
        editor.document,
        initialContent?.length
          ? initialContent as PartialBlock[]
          : [{ type: "paragraph", content: [] }],
      );
    } finally {
      replacingRef.current = false;
    }
  }, [editor, initialContent, contentEpoch]);

  useEffect(() => {
    if (!onChange) return;

    const handleChange = () => {
      if (replacingRef.current) return;
      onChange(editor.document);
    };

    const unsubscribe = editor.onChange(handleChange);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [editor, onChange]);

  return <BlockNoteView editor={editor} editable={editable} theme="light" />;
}
