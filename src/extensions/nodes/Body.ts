import { Node, mergeAttributes } from '@tiptap/core';

export interface BodyOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    body: {
      setBody: () => ReturnType;
    };
  }
}

export const Body = Node.create<BodyOptions>({
  name: 'body',
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
    return [{ tag: 'div[data-type="note-body"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'note-body', class: 'note-body' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setBody:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-3': () => this.editor.commands.setBody(),
    };
  },
});
