import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import { useEffect, useState } from 'react';

import {
  SceneHeading,
  Action,
  Character,
  Dialogue,
  Parenthetical,
  Transition,
  PageBreak,
  ScreenplayKeymap,
  PaginationExtension,
} from '../../extensions';
import { ElementTypeIndicator } from './ElementTypeIndicator';
import { PaginatedEditor } from './PaginatedEditor';
import type { ScreenplayElementType, CharacterExtension } from '../../lib/types';
import type { Editor, JSONContent } from '@tiptap/react';
import type { ElementLoopContext } from '../../plugins';

interface ScreenplayEditorProps {
  initialContent?: JSONContent;
  onChange?: (content: JSONContent) => void;
  onSelectionChange?: () => void;
  resolveElementLoop?: (context: ElementLoopContext) => ScreenplayElementType | null;
  onEditorReady?: (editor: Editor | null) => void;
}

// Custom document that only allows screenplay elements
const ScreenplayDocument = Document.extend({
  content: '(sceneHeading | action | character | dialogue | parenthetical | transition | pageBreak)+',
});

const DEFAULT_CONTENT: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'sceneHeading',
      content: [],
    },
  ],
};

export function ScreenplayEditor({
  initialContent,
  onChange,
  onSelectionChange,
  resolveElementLoop,
  onEditorReady,
}: ScreenplayEditorProps) {
  const [currentElement, setCurrentElement] = useState<ScreenplayElementType | null>('sceneHeading');
  const [characterExtension, setCharacterExtension] = useState<CharacterExtension>(null);

  const editor = useEditor({
    extensions: [
      ScreenplayDocument,
      Text,
      History,
      Bold,
      Italic,
      Underline,
      SceneHeading,
      Action,
      Character,
      Dialogue,
      Parenthetical,
      Transition,
      PageBreak,
      ScreenplayKeymap.configure({
        resolveElementLoop,
      }),
      PaginationExtension,
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
    ],
    content: initialContent || DEFAULT_CONTENT,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON());
      // Update current element type when content changes (e.g., Tab to switch element)
      const { $from } = editor.state.selection;
      const nodeName = $from.parent.type.name;
      setCurrentElement(nodeName as ScreenplayElementType);
      
      // Also update character extension on content change
      if (nodeName === 'character') {
        setCharacterExtension($from.parent.attrs.extension as CharacterExtension);
      } else {
        setCharacterExtension(null);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      const { $from } = editor.state.selection;
      const node = $from.parent;
      const nodeName = node.type.name;
      setCurrentElement(nodeName as ScreenplayElementType);

      // Track character extension when on character node
      if (nodeName === 'character') {
        setCharacterExtension(node.attrs.extension as CharacterExtension);
      } else {
        setCharacterExtension(null);
      }

      onSelectionChange?.();
    },
    editorProps: {
      attributes: {
        class: 'screenplay-editor',
      },
    },
  });

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  return (
    <>
      <PaginatedEditor editor={editor}>
        <EditorContent editor={editor} />
      </PaginatedEditor>
      <ElementTypeIndicator
        currentType={currentElement}
        characterExtension={characterExtension}
      />
    </>
  );
}
