import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface ComicPanelOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comicPanel: {
      setComicPanel: () => ReturnType;
    };
  }
}

const COMIC_PANEL_REGEX = /^(PANEL)\s$/i;

export const ComicPanel = Node.create<ComicPanelOptions>({
  name: 'comicPanel',
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
    return [{ tag: 'div[data-type="comic-panel"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'comic-panel', class: 'comic-panel' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setComicPanel:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: COMIC_PANEL_REGEX,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          tr.setBlockType(range.from, range.to, this.type);
          tr.insertText(`${match[1].toUpperCase()} `, range.from, range.to);
        },
      }),
    ];
  },
});
