import { Node, mergeAttributes } from '@tiptap/core';

export interface ParentheticalOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    parenthetical: {
      setParenthetical: () => ReturnType;
    };
  }
}

export const Parenthetical = Node.create<ParentheticalOptions>({
  name: 'parenthetical',
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="parenthetical"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'parenthetical', class: 'parenthetical' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setParenthetical:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-5': () => this.editor.commands.setParenthetical(),
    };
  },
});
