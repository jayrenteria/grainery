import { Node, mergeAttributes, textblockTypeInputRule } from '@tiptap/core';

export interface BulletItemOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bulletItem: {
      setBulletItem: () => ReturnType;
    };
  }
}

// Matches "- " or "* " at the start of a line
const BULLET_ITEM_REGEX = /^\s*[-*]\s$/;

export const BulletItem = Node.create<BulletItemOptions>({
  name: 'bulletItem',
  group: 'block',
  content: 'text*',
  marks: 'bold italic underline strike fontFamily textSize',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="bullet-item"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'bullet-item', class: 'bullet-item' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setBulletItem:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-4': () => this.editor.commands.setBulletItem(),
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: BULLET_ITEM_REGEX,
        type: this.type,
      }),
    ];
  },
});
