import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface CaptionOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    caption: {
      setCaption: () => ReturnType;
    };
  }
}

const CAPTION_REGEX = /^(CAP(?:TION)?:)\s?$/i;

export const Caption = Node.create<CaptionOptions>({
  name: 'caption',
  group: 'block',
  content: 'text*',
  marks: 'bold italic underline fontFamily textSize',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="caption"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'caption', class: 'caption' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setCaption:
        () =>
        ({ commands, state }) => {
          const shouldSeed = state.selection.$from.parent.textContent.trim().length === 0;
          return commands.setNode(this.name) && (!shouldSeed || commands.insertContent('CAP: '));
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: CAPTION_REGEX,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.setBlockType(range.from, range.to, this.type);
          tr.insertText('CAP: ', range.from, range.to);
        },
      }),
    ];
  },
});
