import { useEffect, useState, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { PAGE_WIDTH_PX, PAGE_HEIGHT_PX, PAGE_GAP_PX } from '../../lib/paginationConstants';
import type { PaginationStorage } from '../../extensions';

interface PaginatedEditorProps {
  editor: Editor | null;
  children: React.ReactNode;
}

export function PaginatedEditor({ editor, children }: PaginatedEditorProps) {
  const [totalPages, setTotalPages] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;

    const updatePages = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paginationStorage = (editor.storage as any).pagination as PaginationStorage | undefined;
      const pages = paginationStorage?.totalPages || 1;
      setTotalPages(pages);
    };

    // Initial update
    updatePages();

    // Listen for document changes
    editor.on('transaction', updatePages);

    return () => {
      editor.off('transaction', updatePages);
    };
  }, [editor]);

  const totalHeight = totalPages * PAGE_HEIGHT_PX + (totalPages - 1) * PAGE_GAP_PX;

  return (
    <div className="paginated-editor-container" ref={containerRef}>
      <div
        className="paginated-editor-wrapper"
        style={{
          width: PAGE_WIDTH_PX,
          minHeight: totalHeight,
        }}
      >
        {/* Background paper pages */}
        <div className="paginated-editor-pages" aria-hidden="true">
          {Array.from({ length: totalPages }).map((_, index) => {
            const top = index * (PAGE_HEIGHT_PX + PAGE_GAP_PX);
            return (
              <div
                key={index}
                className="paginated-editor-page"
                style={{
                  top,
                  width: PAGE_WIDTH_PX,
                  height: PAGE_HEIGHT_PX,
                }}
              >
                {/* Page number in top-right corner (matching PDF format) */}
                {index > 0 && (
                  <div className="paginated-editor-page-number">{index + 1}.</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actual editor content */}
        <div className="paginated-editor-content">{children}</div>
      </div>
    </div>
  );
}
