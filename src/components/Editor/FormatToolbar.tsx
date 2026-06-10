import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';

interface FormatToolbarProps {
  editor: Editor | null;
}

interface FormatButton {
  mark: string;
  label: string;
  title: string;
  className: string;
  toggle: (editor: Editor) => void;
}

const FORMAT_BUTTONS: FormatButton[] = [
  {
    mark: 'bold',
    label: 'B',
    title: 'Bold (⌘B)',
    className: 'format-toolbar-bold',
    toggle: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    mark: 'italic',
    label: 'I',
    title: 'Italic (⌘I)',
    className: 'format-toolbar-italic',
    toggle: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    mark: 'underline',
    label: 'U',
    title: 'Underline (⌘U)',
    className: 'format-toolbar-underline',
    toggle: (editor) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    mark: 'strike',
    label: 'S',
    title: 'Strikethrough (⌘⇧S)',
    className: 'format-toolbar-strike',
    toggle: (editor) => editor.chain().focus().toggleStrike().run(),
  },
];

export function FormatToolbar({ editor }: FormatToolbarProps) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const refresh = () => setVersion((prev) => prev + 1);

    editor.on('transaction', refresh);
    editor.on('selectionUpdate', refresh);

    return () => {
      editor.off('transaction', refresh);
      editor.off('selectionUpdate', refresh);
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="format-toolbar" role="toolbar" aria-label="Text formatting">
      {FORMAT_BUTTONS.map((button) => (
        <button
          key={button.mark}
          type="button"
          title={button.title}
          aria-pressed={editor.isActive(button.mark)}
          className={`format-toolbar-button ${button.className}${
            editor.isActive(button.mark) ? ' is-active' : ''
          }`}
          onMouseDown={(event) => {
            // Keep focus and selection in the editor while clicking the toolbar.
            event.preventDefault();
          }}
          onClick={() => button.toggle(editor)}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
