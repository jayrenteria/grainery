import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import {
  getEnterElementType,
  getNextElementType,
  getPreviousElementType,
  isScreenplayElementType,
} from '../lib/elementConfig';
import type { DocumentMode, ScreenplayElementType } from '../lib/types';
import type { ElementLoopContext } from '../plugins';

export interface ScreenplayKeymapOptions {
  documentMode: DocumentMode;
  resolveElementLoop?: (context: ElementLoopContext) => ScreenplayElementType | null;
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

function insertNewNodeOfType(editor: Editor, nextType: ScreenplayElementType): boolean {
  const { $from } = editor.state.selection;
  const endPos = $from.end();

  return editor.chain().insertContentAt(endPos + 1, { type: nextType }).focus().run();
}

export const ScreenplayKeymap = Extension.create<ScreenplayKeymapOptions>({
  name: 'screenplayKeymap',

  priority: 1000,

  addOptions() {
    return {
      documentMode: 'screenplay',
      resolveElementLoop: undefined,
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

        const prevNodeType = getPreviousNodeType($from);
        const pluginType = resolveFromPlugins(this.options.resolveElementLoop, {
          event: 'tab',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: currentNode.textContent.trim().length === 0,
        });

        if (pluginType) {
          return editor.commands.setNode(pluginType);
        }

        const nextType = getNextElementType(this.options.documentMode, currentType, prevNodeType);
        return editor.commands.setNode(nextType);
      },
      'Shift-Tab': ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const currentType = currentNode.type.name;

        if (!isScreenplayElementType(currentType)) {
          return false;
        }

        const prevNodeType = getPreviousNodeType($from);
        const pluginType = resolveFromPlugins(this.options.resolveElementLoop, {
          event: 'shift-tab',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: currentNode.textContent.trim().length === 0,
        });

        if (pluginType) {
          return editor.commands.setNode(pluginType);
        }

        const prevType = getPreviousElementType(this.options.documentMode, currentType, prevNodeType);
        return editor.commands.setNode(prevType);
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

        const pluginType = resolveFromPlugins(this.options.resolveElementLoop, {
          event: 'escape',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: currentNode.textContent.trim().length === 0,
        });

        if (pluginType) {
          return editor.commands.setNode(pluginType);
        }

        if (currentType !== 'action') {
          return editor.commands.setNode('action');
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
        const pluginType = resolveFromPlugins(this.options.resolveElementLoop, {
          event: 'enter',
          currentType,
          documentMode: this.options.documentMode,
          previousType: prevNodeType,
          isCurrentEmpty: currentNode.textContent.trim().length === 0,
        });

        if (pluginType) {
          return insertNewNodeOfType(editor, pluginType);
        }

        const nextType = getEnterElementType(this.options.documentMode, currentType);

        return insertNewNodeOfType(editor, nextType);
      },
    };
  },
});
