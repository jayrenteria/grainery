import { Mark, mergeAttributes } from '@tiptap/core';
import {
  normalizeFontFamily,
  normalizeFontStyle,
  normalizeFontWeight,
  type FontStyleValue,
} from '../../lib/textStyles';

export interface FontFamilyOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface FontFamilyStyleAttributes {
  fontWeight?: number | string | null;
  fontStyle?: FontStyleValue | string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (fontFamily: string, attributes?: FontFamilyStyleAttributes) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
  }
}

function stripCssQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function toCssFontFamily(fontFamily: string): string {
  return JSON.stringify(fontFamily);
}

export const FontFamily = Mark.create<FontFamilyOptions>({
  name: 'fontFamily',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      fontFamily: {
        default: null,
        parseHTML: (element) => {
          const dataValue = element.getAttribute('data-font-family');
          if (dataValue) {
            return normalizeFontFamily(dataValue);
          }

          const styleValue = (element as HTMLElement).style.fontFamily;
          if (!styleValue) {
            return null;
          }

          return normalizeFontFamily(stripCssQuotes(styleValue.split(',')[0] ?? ''));
        },
        renderHTML: (attributes) => {
          const fontFamily = normalizeFontFamily(attributes.fontFamily);
          if (!fontFamily) {
            return {};
          }

          const fontWeight = normalizeFontWeight(attributes.fontWeight);
          const fontStyle = normalizeFontStyle(attributes.fontStyle);
          const styleParts = [`font-family: ${toCssFontFamily(fontFamily)}`];
          if (fontWeight !== null) {
            styleParts.push(`font-weight: ${fontWeight}`);
          }
          if (fontStyle) {
            styleParts.push(`font-style: ${fontStyle}`);
          }

          return {
            'data-font-family': fontFamily,
            ...(fontWeight !== null ? { 'data-font-weight': String(fontWeight) } : {}),
            ...(fontStyle ? { 'data-font-style': fontStyle } : {}),
            style: styleParts.join('; '),
          };
        },
      },
      fontWeight: {
        default: null,
        parseHTML: (element) => {
          return normalizeFontWeight(
            element.getAttribute('data-font-weight') || (element as HTMLElement).style.fontWeight
          );
        },
        renderHTML: () => ({}),
      },
      fontStyle: {
        default: null,
        parseHTML: (element) => {
          return normalizeFontStyle(
            element.getAttribute('data-font-style') || (element as HTMLElement).style.fontStyle
          );
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-font-family]' },
      {
        tag: 'span[style]',
        getAttrs: (element) => {
          const fontFamily = (element as HTMLElement).style.fontFamily;
          return fontFamily ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFontFamily:
        (fontFamily, attributes = {}) =>
        ({ commands }) => {
          const normalized = normalizeFontFamily(fontFamily);
          if (!normalized) {
            return false;
          }

          return commands.setMark(this.name, {
            fontFamily: normalized,
            fontWeight: normalizeFontWeight(attributes.fontWeight),
            fontStyle: normalizeFontStyle(attributes.fontStyle),
          });
        },
      unsetFontFamily:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },
});
