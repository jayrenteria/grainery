import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  Title,
  Heading,
  Body,
  BulletItem,
  NumberedItem,
  ScreenplayKeymap,
  PaginationExtension,
  FindReplaceExtension,
  getFindReplaceState,
  PluginAnnotationsExtension,
  PluginLandmarksExtension,
  InactiveSelectionExtension,
  FontFamily,
  TextSize,
  BlockAlignment,
} from '../../extensions';
import {
  DEFAULT_ELEMENT_BY_MODE,
  getDefaultContent,
  getDocumentSchemaContentExpression,
  hasOnlyElementSeedText,
  isScreenplayElementType,
} from '../../lib/elementConfig';
import { ElementTypeIndicator } from './ElementTypeIndicator';
import { EditorStats } from './EditorStats';
import { FindReplaceBar } from './FindReplaceBar';
import { FormatToolbar } from './FormatToolbar';
import { KeymapHint } from './KeymapHint';
import { PaginatedEditor } from './PaginatedEditor';
import type { ScreenplayElementType, CharacterExtension, DocumentMode } from '../../lib/types';
import type { ElementLoopPreferences } from '../../lib/elementLoopPreferences';
import type { Editor, JSONContent } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type {
  EditorCompletionContext,
  ElementLoopContext,
  RenderedEditorCompletion,
  RenderedEditorLandmark,
  RenderedInlineAnnotation,
} from '../../plugins';

interface ScreenplayEditorProps {
  documentId: string;
  initialContent?: JSONContent;
  inlineAnnotations?: RenderedInlineAnnotation[];
  editorLandmarks?: RenderedEditorLandmark[];
  onChange?: (content: JSONContent) => void;
  onSelectionChange?: () => void;
  resolveElementLoop?: (context: ElementLoopContext) => ScreenplayElementType | null;
  elementLoopPreferences?: ElementLoopPreferences;
  onEditorReady?: (editor: Editor | null) => void;
  showKeymapHint?: boolean;
  keepKeymapHintVisible?: boolean;
  documentMode?: DocumentMode;
  resolveEditorCompletions?: (
    context: EditorCompletionContext
  ) => Promise<RenderedEditorCompletion[]>;
}

const VIEWPORT_TARGET_RATIO = 0.45;
const VIEWPORT_UPPER_TRIGGER_RATIO = 0.28;
const VIEWPORT_LOWER_TRIGGER_RATIO = 0.62;
const COMPLETION_DEBOUNCE_MS = 90;

interface CompletionMenuState {
  items: RenderedEditorCompletion[];
  activeIndex: number;
  left: number;
  top: number;
}

function applyEditorCompletion(view: EditorView, item: RenderedEditorCompletion): boolean {
  const { $from } = view.state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.name !== 'character') {
    return false;
  }

  const blockFrom = $from.start();
  const blockTo = $from.end();
  const from = Math.floor(item.replaceFrom);
  const to = Math.floor(item.replaceTo);
  if (from < blockFrom || to > blockTo || to < from || !item.insertText) {
    return false;
  }

  const firstChild = $from.parent.firstChild;
  const marks = firstChild?.isText ? firstChild.marks : [];
  const replacement = view.state.schema.text(item.insertText, marks);
  const transaction = view.state.tr.replaceWith(from, to, replacement);
  const nextPosition = Math.min(from + replacement.nodeSize, transaction.doc.content.size);
  transaction.setSelection(TextSelection.create(transaction.doc, nextPosition));
  view.dispatch(transaction);
  view.focus();
  return true;
}

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
  documentId,
  initialContent,
  inlineAnnotations = [],
  editorLandmarks = [],
  onChange,
  onSelectionChange,
  resolveElementLoop,
  elementLoopPreferences,
  onEditorReady,
  showKeymapHint = true,
  keepKeymapHintVisible = false,
  documentMode = 'screenplay',
  resolveEditorCompletions,
}: ScreenplayEditorProps) {
  const [currentElement, setCurrentElement] = useState<ScreenplayElementType | null>(
    DEFAULT_ELEMENT_BY_MODE[documentMode]
  );
  const [characterExtension, setCharacterExtension] = useState<CharacterExtension>(null);
  const [previousElement, setPreviousElement] = useState<string | null>(null);
  const [isCurrentElementEmpty, setIsCurrentElementEmpty] = useState(true);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [completionMenu, setCompletionMenu] = useState<CompletionMenuState | null>(null);
  const completionMenuRef = useRef<CompletionMenuState | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionRequestRef = useRef(0);
  const completionResolverRef = useRef(resolveEditorCompletions);
  const scriptDocument = useMemo(
    () =>
      Document.extend({
        content: getDocumentSchemaContentExpression(documentMode),
      }),
    [documentMode]
  );

  const updateCompletionMenu = useCallback((next: CompletionMenuState | null) => {
    completionMenuRef.current = next;
    setCompletionMenu(next);
  }, []);

  const clearCompletionMenu = useCallback(() => {
    completionRequestRef.current += 1;
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    updateCompletionMenu(null);
  }, [updateCompletionMenu]);

  const scheduleCompletions = (activeEditor: Editor) => {
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }

    const resolver = completionResolverRef.current;
    const { selection } = activeEditor.state;
    const { $from } = selection;
    if (
      !resolver
      || documentMode !== 'screenplay'
      || !selection.empty
      || $from.parent.type.name !== 'character'
      || $from.parentOffset !== $from.parent.content.size
    ) {
      updateCompletionMenu(null);
      return;
    }

    const query = $from.parent.textBetween(0, $from.parentOffset, '', '');
    if (query.trim().length < 1) {
      updateCompletionMenu(null);
      return;
    }

    const requestId = completionRequestRef.current + 1;
    completionRequestRef.current = requestId;
    const context: EditorCompletionContext = {
      document: activeEditor.getJSON(),
      documentMode,
      currentElementType: 'character',
      currentBlockIndex: $from.index(0),
      currentBlockText: $from.parent.textContent,
      query,
      replaceFrom: $from.start(),
      replaceTo: $from.end(),
      selectionFrom: selection.from,
      selectionTo: selection.to,
      cursorAtBlockEnd: true,
    };

    completionTimerRef.current = setTimeout(() => {
      completionTimerRef.current = null;
      void resolver(context)
        .then((items) => {
          if (completionRequestRef.current !== requestId || items.length === 0) {
            if (completionRequestRef.current === requestId) {
              updateCompletionMenu(null);
            }
            return;
          }

          const currentSelection = activeEditor.state.selection;
          if (
            !currentSelection.empty
            || currentSelection.from !== context.selectionFrom
            || currentSelection.$from.parent.type.name !== 'character'
          ) {
            return;
          }

          try {
            const coordinates = activeEditor.view.coordsAtPos(currentSelection.from);
            const estimatedHeight = Math.min(items.length, 8) * 36 + 8;
            const left = Math.min(Math.max(8, coordinates.left), Math.max(8, window.innerWidth - 300));
            const top = coordinates.bottom + estimatedHeight <= window.innerHeight - 8
              ? coordinates.bottom + 6
              : Math.max(8, coordinates.top - estimatedHeight - 6);
            updateCompletionMenu({ items, activeIndex: 0, left, top });
          } catch {
            updateCompletionMenu(null);
          }
        })
        .catch((error) => {
          if (completionRequestRef.current === requestId) {
            console.error('[Plugins] Failed to resolve editor completions', error);
            updateCompletionMenu(null);
          }
        });
    }, COMPLETION_DEBOUNCE_MS);
  };

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
      Strike,
      FontFamily,
      TextSize,
      BlockAlignment,
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
      Title,
      Heading,
      Body,
      BulletItem,
      NumberedItem,
      FindReplaceExtension,
      PluginAnnotationsExtension,
      PluginLandmarksExtension,
      InactiveSelectionExtension,
      ScreenplayKeymap.configure({
        documentMode,
        resolveElementLoop,
        elementLoopPreferences,
      }),
      // Free write is a continuous canvas; only paginated modes compute page breaks.
      ...(documentMode === 'freewrite'
        ? []
        : [
            PaginationExtension.configure({
              documentMode,
            }),
          ]),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
    ],
    content: initialContent || getDefaultContent(documentMode),
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON());
      keepCaretNearViewportCenter(editor);
      syncElementContext(editor);
      scheduleCompletions(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      syncElementContext(editor);
      onSelectionChange?.();
      scheduleCompletions(editor);
    },
    editorProps: {
      attributes: {
        class: 'screenplay-editor',
        'data-document-mode': documentMode,
      },
      handleKeyDown: (view, event) => {
        const menu = completionMenuRef.current;
        if (!menu || menu.items.length === 0) {
          return false;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          const activeIndex =
            (menu.activeIndex + direction + menu.items.length) % menu.items.length;
          updateCompletionMenu({ ...menu, activeIndex });
          return true;
        }

        if (event.key === 'Tab' && menu.activeIndex >= 0) {
          event.preventDefault();
          const applied = applyEditorCompletion(view, menu.items[menu.activeIndex]);
          clearCompletionMenu();
          return applied;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          clearCompletionMenu();
          return true;
        }

        if (event.key === 'Enter') {
          clearCompletionMenu();
        }

        return false;
      },
    },
  }, [documentId, documentMode]);

  useEffect(() => {
    completionResolverRef.current = resolveEditorCompletions;
    if (!resolveEditorCompletions) {
      clearCompletionMenu();
    }
  }, [clearCompletionMenu, resolveEditorCompletions]);

  useEffect(
    () => () => {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }
      completionRequestRef.current += 1;
    }, []
  );

  useEffect(() => {
    if (!completionMenu) {
      return;
    }

    const dismiss = () => clearCompletionMenu();
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [clearCompletionMenu, completionMenu]);

  useEffect(() => {
    onEditorReady?.(editor);

    if (editor) {
      syncElementContext(editor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    const keymapExtension = editor?.extensionManager.extensions.find(
      (extension) => extension.name === 'screenplayKeymap'
    );

    if (keymapExtension) {
      keymapExtension.options.elementLoopPreferences = elementLoopPreferences;
    }
  }, [editor, elementLoopPreferences]);

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

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.commands.setPluginLandmarks(editorLandmarks);
  }, [editor, editorLandmarks]);

  return (
    <>
      <PaginatedEditor editor={editor} paginated={documentMode !== 'freewrite'}>
        <EditorContent editor={editor} />
      </PaginatedEditor>
      {completionMenu && editor ? (
        <div
          className="plugin-completion-menu"
          style={{ left: completionMenu.left, top: completionMenu.top }}
          role="listbox"
          aria-label="Character suggestions"
        >
          {completionMenu.items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === completionMenu.activeIndex}
              className={`plugin-completion-item${index === completionMenu.activeIndex ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() =>
                updateCompletionMenu({ ...completionMenu, activeIndex: index })
              }
              onClick={() => {
                applyEditorCompletion(editor.view, item);
                clearCompletionMenu();
              }}
            >
              <span className="plugin-completion-label">{item.label}</span>
              {item.detail ? <span className="plugin-completion-detail">{item.detail}</span> : null}
            </button>
          ))}
          <div className="plugin-completion-hint">Tab to complete · Esc to dismiss</div>
        </div>
      ) : null}
      {documentMode === 'freewrite' && <FormatToolbar editor={editor} />}
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
          elementLoopPreferences={elementLoopPreferences}
          keepVisible={keepKeymapHintVisible}
        />
      )}
      <EditorStats editor={editor} showPageCount={documentMode !== 'freewrite'} />
    </>
  );
}
