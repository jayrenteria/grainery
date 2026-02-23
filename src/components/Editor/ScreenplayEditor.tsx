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
  FindReplaceExtension,
  getFindReplaceState,
  PluginAnnotationsExtension,
} from '../../extensions';
import { ElementTypeIndicator } from './ElementTypeIndicator';
import { FindReplaceBar } from './FindReplaceBar';
import { PaginatedEditor } from './PaginatedEditor';
import type { ScreenplayElementType, CharacterExtension } from '../../lib/types';
import type { Editor, JSONContent } from '@tiptap/react';
import type { ElementLoopContext, RenderedInlineAnnotation } from '../../plugins';

interface ScreenplayEditorProps {
  initialContent?: JSONContent;
  inlineAnnotations?: RenderedInlineAnnotation[];
  onChange?: (content: JSONContent) => void;
  onSelectionChange?: () => void;
  resolveElementLoop?: (context: ElementLoopContext) => ScreenplayElementType | null;
  onEditorReady?: (editor: Editor | null) => void;
}

const VIEWPORT_TARGET_RATIO = 0.45;
const VIEWPORT_UPPER_TRIGGER_RATIO = 0.28;
const VIEWPORT_LOWER_TRIGGER_RATIO = 0.62;

function keepCaretNearViewportCenter(editor: Editor): void {
  const { view } = editor;
  const { from, empty } = view.state.selection;
  if (!empty) {
    return;
  }

  const scrollContainer = view.dom.closest('.paginated-editor-container');
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }

  requestAnimationFrame(() => {
    try {
      const caretCoords = view.coordsAtPos(from);
      const containerRect = scrollContainer.getBoundingClientRect();
      const caretYInViewport = caretCoords.top - containerRect.top;
      const viewportHeight = containerRect.height;
      const upperTrigger = viewportHeight * VIEWPORT_UPPER_TRIGGER_RATIO;
      const lowerTrigger = viewportHeight * VIEWPORT_LOWER_TRIGGER_RATIO;

      if (caretYInViewport >= upperTrigger && caretYInViewport <= lowerTrigger) {
        return;
      }

      const targetScrollTop =
        scrollContainer.scrollTop + caretYInViewport - viewportHeight * VIEWPORT_TARGET_RATIO;

      scrollContainer.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'auto',
      });
    } catch {
      // Ignore transient coordinate errors while the document is reflowing.
    }
  });
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
  inlineAnnotations = [],
  onChange,
  onSelectionChange,
  resolveElementLoop,
  onEditorReady,
}: ScreenplayEditorProps) {
  const [currentElement, setCurrentElement] = useState<ScreenplayElementType | null>('sceneHeading');
  const [characterExtension, setCharacterExtension] = useState<CharacterExtension>(null);
  const [isFindOpen, setIsFindOpen] = useState(false);

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
      FindReplaceExtension,
      PluginAnnotationsExtension,
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
      keepCaretNearViewportCenter(editor);
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

  useEffect(() => {
    if (!editor) {
      setIsFindOpen(false);
      return;
    }

    const syncFindOpen = () => {
      setIsFindOpen(getFindReplaceState(editor).isOpen);
    };

    syncFindOpen();
    editor.on('transaction', syncFindOpen);

    return () => {
      editor.off('transaction', syncFindOpen);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.commands.setPluginAnnotations(inlineAnnotations);
  }, [editor, inlineAnnotations]);

  return (
    <>
      <PaginatedEditor editor={editor}>
        <EditorContent editor={editor} />
      </PaginatedEditor>
      <FindReplaceBar
        editor={editor}
        isOpen={isFindOpen}
        onClose={() => {
          setIsFindOpen(false);
        }}
      />
      <ElementTypeIndicator
        currentType={currentElement}
        characterExtension={characterExtension}
      />
    </>
  );
}
