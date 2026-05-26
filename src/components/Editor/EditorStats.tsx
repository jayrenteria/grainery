import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { PaginationStorage } from '../../extensions';

interface EditorStatsProps {
  editor: Editor | null;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function EditorStats({ editor }: EditorStatsProps) {
  const [wordCount, setWordCount] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      setWordCount(countWords(editor.getText()));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paginationStorage = (editor.storage as any).pagination as PaginationStorage | undefined;
      setPageCount(paginationStorage?.totalPages || 1);
    };

    update();
    editor.on('transaction', update);

    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  return (
    <div className="editor-stats">
      <span>{wordCount} W</span>
      <span>{pageCount} PG</span>
    </div>
  );
}
