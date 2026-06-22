import { Mark, mergeAttributes } from '@tiptap/core';
import { normalizeTextSize } from '../../lib/textStyles';

export interface TextSizeOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textSize: {
      setTextSize: (sizePt: number) => ReturnType;
      unsetTextSize: () => ReturnType;
    };
  }
}

export const TextSize = Mark.create<TextSizeOptions>({
  name: 'textSize',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      sizePt: {
        default: null,
        parseHTML: (element) => {
          const dataValue = element.getAttribute('data-text-size');
          if (dataValue) {
            return normalizeTextSize(dataValue);
          }

          return normalizeTextSize((element as HTMLElement).style.fontSize);
        },
        renderHTML: (attributes) => {
          const sizePt = normalizeTextSize(attributes.sizePt);
          if (!sizePt) {
            return {};
          }

          return {
            'data-text-size': String(sizePt),
            style: `font-size: ${sizePt}pt`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-text-size]' },
      {
        tag: 'span[style]',
        getAttrs: (element) => {
          const fontSize = (element as HTMLElement).style.fontSize;
          return fontSize ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextSize:
        (sizePt) =>
        ({ commands }) => {
          const normalized = normalizeTextSize(sizePt);
          if (!normalized) {
            return false;
          }

          return commands.setMark(this.name, { sizePt: normalized });
        },
      unsetTextSize:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },
});
