import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import { useEffect, useMemo, useState } from 'react';

import {
  SceneHeading,
  Action,
  Character,
  Dialogue,
  Parenthetical,
  Transition,
  ComicPage,
  ComicPanel,
  Caption,
  SoundEffect,
  PageBreak,
  ScreenplayKeymap,
  PaginationExtension,
  FindReplaceExtension,
  getFindReplaceState,
  PluginAnnotationsExtension,
} from '../../extensions';
import {
  getDefaultContent,
  getDocumentSchemaContentExpression,
  hasOnlyElementSeedText,
  isScreenplayElementType,
} from '../../lib/elementConfig';
import { ElementTypeIndicator } from './ElementTypeIndicator';
import { EditorStats } from './EditorStats';
import { FindReplaceBar } from './FindReplaceBar';
import { KeymapHint } from './KeymapHint';
import { PaginatedEditor } from './PaginatedEditor';
import type { ScreenplayElementType, CharacterExtension, DocumentMode } from '../../lib/types';
import type { Editor, JSONContent } from '@tiptap/react';
import type { ElementLoopContext, RenderedInlineAnnotation } from '../../plugins';

interface ScreenplayEditorProps {
  initialContent?: JSONContent;
  inlineAnnotations?: RenderedInlineAnnotation[];
  onChange?: (content: JSONContent) => void;
  onSelectionChange?: () => void;
  resolveElementLoop?: (context: ElementLoopContext) => ScreenplayElementType | null;
  onEditorReady?: (editor: Editor | null) => void;
  showKeymapHint?: boolean;
  documentMode?: DocumentMode;
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

function getPreviousNodeType(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  const currentIndex = $from.index($from.depth - 1);

  if (currentIndex > 0) {
    return $from.doc.child(currentIndex - 1).type.name;
  }

  return null;
}

export function ScreenplayEditor({
  initialContent,
  inlineAnnotations = [],
  onChange,
  onSelectionChange,
  resolveElementLoop,
  onEditorReady,
  showKeymapHint = true,
  documentMode = 'screenplay',
}: ScreenplayEditorProps) {
  const [currentElement, setCurrentElement] = useState<ScreenplayElementType | null>(
    documentMode === 'comic' ? 'comicPage' : 'sceneHeading'
  );
  const [characterExtension, setCharacterExtension] = useState<CharacterExtension>(null);
  const [previousElement, setPreviousElement] = useState<string | null>(null);
  const [isCurrentElementEmpty, setIsCurrentElementEmpty] = useState(true);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const scriptDocument = useMemo(
    () =>
      Document.extend({
        content: getDocumentSchemaContentExpression(documentMode),
      }),
    [documentMode]
  );

  const syncElementContext = (editor: Editor) => {
    const { $from } = editor.state.selection;
    const node = $from.parent;
    const nodeName = node.type.name;
    const currentType = isScreenplayElementType(nodeName) ? nodeName : null;

    setCurrentElement(currentType);
    setPreviousElement(getPreviousNodeType(editor));
    setIsCurrentElementEmpty(
      node.textContent.trim().length === 0 ||
        Boolean(currentType && hasOnlyElementSeedText(currentType, node.textContent))
    );

    if (nodeName === 'character') {
      setCharacterExtension(node.attrs.extension as CharacterExtension);
    } else {
      setCharacterExtension(null);
    }
  };

  const editor = useEditor({
    extensions: [
      scriptDocument,
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
      ComicPage,
      ComicPanel,
      Caption,
      SoundEffect,
      PageBreak,
      FindReplaceExtension,
      PluginAnnotationsExtension,
      ScreenplayKeymap.configure({
        documentMode,
        resolveElementLoop,
      }),
      PaginationExtension.configure({
        documentMode,
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
    ],
    content: initialContent || getDefaultContent(documentMode),
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON());
      keepCaretNearViewportCenter(editor);
      syncElementContext(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      syncElementContext(editor);
      onSelectionChange?.();
    },
    editorProps: {
      attributes: {
        class: 'screenplay-editor',
        'data-document-mode': documentMode,
      },
    },
  });

  useEffect(() => {
    onEditorReady?.(editor);

    if (editor) {
      syncElementContext(editor);
    }
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
      {showKeymapHint && (
        <KeymapHint
          documentMode={documentMode}
          currentType={currentElement}
          previousType={previousElement}
          isCurrentEmpty={isCurrentElementEmpty}
          resolveElementLoop={resolveElementLoop}
        />
      )}
      <EditorStats editor={editor} />
    </>
  );
}
