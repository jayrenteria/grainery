import { Node, mergeAttributes, textblockTypeInputRule } from '@tiptap/core';

export interface NumberedItemOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    numberedItem: {
      setNumberedItem: () => ReturnType;
    };
  }
}

// Matches "1. " (any number followed by a period) at the start of a line
const NUMBERED_ITEM_REGEX = /^\s*\d+\.\s$/;

export const NumberedItem = Node.create<NumberedItemOptions>({
  name: 'numberedItem',
  group: 'block',
  content: 'text*',
  marks: 'bold italic underline strike',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="numbered-item"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'numbered-item', class: 'numbered-item' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setNumberedItem:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-5': () => this.editor.commands.setNumberedItem(),
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: NUMBERED_ITEM_REGEX,
        type: this.type,
      }),
    ];
  },
});
