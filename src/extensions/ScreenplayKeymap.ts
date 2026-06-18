import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import {
  getEnterElementType,
  getElementSeedText,
  getEscapeElementType,
  getNextElementType,
  getPreviousElementType,
  hasOnlyElementSeedText,
  isListElementType,
  isScreenplayElementType,
} from '../lib/elementConfig';
import { resolveElementLoopFromPreferences } from '../lib/elementLoopPreferences';
import type { ElementLoopPreferences } from '../lib/elementLoopPreferences';
import type { DocumentMode, ScreenplayElementType } from '../lib/types';
import type { ElementLoopContext } from '../plugins';

export interface ScreenplayKeymapOptions {
  documentMode: DocumentMode;
  resolveElementLoop?: (context: ElementLoopContext) => ScreenplayElementType | null;
  elementLoopPreferences?: ElementLoopPreferences;
}

function getPreviousNodeType($from: ResolvedPos): string | null {
  const doc = $from.doc;
  const currentIndex = $from.index($from.depth - 1);
  if (currentIndex > 0) {
    const prevNode = doc.child(currentIndex - 1);
    return prevNode.type.name;
  }
  return null;
}

function resolveFromPlugins(
  resolver: ((context: ElementLoopContext) => ScreenplayElementType | null) | undefined,
  context: ElementLoopContext
): ScreenplayElementType | null {
  if (!resolver) {
    return null;
  }

  try {
    return resolver(context);
  } catch (error) {
    console.error('[ScreenplayKeymap] Plugin loop resolver failed', error);
    return null;
  }
}

function resolveFromPreferences(
  preferences: ElementLoopPreferences | undefined,
  context: ElementLoopContext
): ScreenplayElementType | null {
  if (!preferences) {
    return null;
  }

  return resolveElementLoopFromPreferences(context, preferences);
}

function insertNewNodeOfType(editor: Editor, nextType: ScreenplayElementType): boolean {
  const { $from } = editor.state.selection;
  const insertPos = $from.end() + 1;
  const seedText = getElementSeedText(nextType);
  const node = seedText
    ? { type: nextType, content: [{ type: 'text', text: seedText }] }
    : { type: nextType };

  const chain = editor.chain().insertContentAt(insertPos, node);
  if (seedText) {
    chain.setTextSelection(insertPos + 1 + seedText.length);
  }
  return chain.focus().run();
}

function isNodeEffectivelyEmpty(type: ScreenplayElementType, text: string): boolean {
  return text.trim().length === 0 || hasOnlyElementSeedText(type, text);
}

function setCurrentNodeType(
  editor: Editor,
  currentType: ScreenplayElementType,
  nextType: ScreenplayElementType,
  currentText: string
): boolean {
  const shouldClearCurrentSeed = hasOnlyElementSeedText(currentType, currentText);
  const shouldSeedNext = isNodeEffectivelyEmpty(currentType, currentText);
  const seedText = shouldSeedNext ? getElementSeedText(nextType) : null;
  const { $from } = editor.state.selection;
  let chain = editor.chain();

  if (shouldClearCurrentSeed) {
    chain = chain.deleteRange({ from: $from.start(), to: $from.end() });
  }

  chain = chain.setNode(nextType);

  if (seedText) {
    chain = chain.insertContent(seedText);
  }

  return chain.focus().run();
}

export const ScreenplayKeymap = Extension.create<ScreenplayKeymapOptions>({
  name: 'screenplayKeymap',

  priority: 1000,

  addOptions() {
    return {
      documentMode: 'screenplay',
      resolveElementLoop: undefined,
      elementLoopPreferences: undefined,
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const currentType = currentNode.type.name;

        if (!isScreenplayElementType(currentType)) {
          return false;
        }

        const currentText = currentNode.textContent;
        const prevNodeType = getPreviousNodeType($from);
        const pluginType = resolveFromPlugins(this.options.resolveElementLoop, {
          event: 'tab',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: isNodeEffectivelyEmpty(currentType, currentText),
        });

        if (pluginType) {
          return setCurrentNodeType(editor, currentType, pluginType, currentText);
        }

        const preferenceType = resolveFromPreferences(this.options.elementLoopPreferences, {
          event: 'tab',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: isNodeEffectivelyEmpty(currentType, currentText),
        });

        const nextType = preferenceType ?? getNextElementType(this.options.documentMode, currentType, prevNodeType);
        return setCurrentNodeType(editor, currentType, nextType, currentText);
      },
      'Shift-Tab': ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const currentType = currentNode.type.name;

        if (!isScreenplayElementType(currentType)) {
          return false;
        }

        const currentText = currentNode.textContent;
        const prevNodeType = getPreviousNodeType($from);
        const pluginType = resolveFromPlugins(this.options.resolveElementLoop, {
          event: 'shift-tab',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: isNodeEffectivelyEmpty(currentType, currentText),
        });

        if (pluginType) {
          return setCurrentNodeType(editor, currentType, pluginType, currentText);
        }

        const preferenceType = resolveFromPreferences(this.options.elementLoopPreferences, {
          event: 'shift-tab',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: isNodeEffectivelyEmpty(currentType, currentText),
        });

        const prevType = preferenceType ?? getPreviousElementType(this.options.documentMode, currentType, prevNodeType);
        return setCurrentNodeType(editor, currentType, prevType, currentText);
      },
      // Escape returns to Action element
      Escape: ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const currentType = currentNode.type.name;
        const prevNodeType = getPreviousNodeType($from);

        if (!isScreenplayElementType(currentType)) {
          return false;
        }

        const currentText = currentNode.textContent;
        const pluginType = resolveFromPlugins(this.options.resolveElementLoop, {
          event: 'escape',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: isNodeEffectivelyEmpty(currentType, currentText),
        });

        if (pluginType) {
          return setCurrentNodeType(editor, currentType, pluginType, currentText);
        }

        const preferenceType = resolveFromPreferences(this.options.elementLoopPreferences, {
          event: 'escape',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: isNodeEffectivelyEmpty(currentType, currentText),
        });
        const escapeType = preferenceType ?? getEscapeElementType(this.options.documentMode);
        if (currentType !== escapeType) {
          return setCurrentNodeType(editor, currentType, escapeType, currentText);
        }

        return false;
      },
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const currentType = currentNode.type.name;

        // Only handle special cases for screenplay elements
        if (!isScreenplayElementType(currentType)) {
          return false;
        }

        const prevNodeType = getPreviousNodeType($from);
        const isCurrentEmpty = isNodeEffectivelyEmpty(currentType, currentNode.textContent);
        const pluginType = resolveFromPlugins(this.options.resolveElementLoop, {
          event: 'enter',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty,
        });

        if (pluginType) {
          return insertNewNodeOfType(editor, pluginType);
        }

        const preferenceType = resolveFromPreferences(this.options.elementLoopPreferences, {
          event: 'enter',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty,
        });

        const nextType = preferenceType ?? getEnterElementType(this.options.documentMode, currentType, isCurrentEmpty);

        // Enter on an empty list item converts it in place instead of adding a new block.
        if (isCurrentEmpty && isListElementType(currentType) && nextType !== currentType) {
          return setCurrentNodeType(editor, currentType, nextType, currentNode.textContent);
        }

        return insertNewNodeOfType(editor, nextType);
      },
    };
  },
});
