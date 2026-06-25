import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface ComicPageOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comicPage: {
      setComicPage: () => ReturnType;
    };
  }
}

const COMIC_PAGE_REGEX = /^(PAGE)\s$/i;

export const ComicPage = Node.create<ComicPageOptions>({
  name: 'comicPage',
  group: 'block',
  content: 'text*',
  marks: 'fontFamily textSize',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="comic-page"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'comic-page', class: 'comic-page' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setComicPage:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: COMIC_PAGE_REGEX,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          tr.setBlockType(range.from, range.to, this.type);
          tr.insertText(`${match[1].toUpperCase()} `, range.from, range.to);
        },
      }),
    ];
  },
});
