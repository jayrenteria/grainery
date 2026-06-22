import { Extension } from '@tiptap/core';
import { normalizeTextAlignment, type TextAlignment } from '../lib/textStyles';

export type { TextAlignment } from '../lib/textStyles';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockAlignment: {
      setTextAlignment: (alignment: TextAlignment) => ReturnType;
    };
  }
}

const ALIGNABLE_NODE_TYPES = [
  'sceneHeading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'comicPage',
  'comicPanel',
  'caption',
  'soundEffect',
  'title',
  'heading',
  'body',
  'bulletItem',
  'numberedItem',
];
const ALIGNABLE_NODE_TYPE_SET = new Set(ALIGNABLE_NODE_TYPES);

export const BlockAlignment = Extension.create({
  name: 'blockAlignment',

  addGlobalAttributes() {
    return [
      {
        types: ALIGNABLE_NODE_TYPES,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => {
              return normalizeTextAlignment(
                element.getAttribute('data-text-align') || (element as HTMLElement).style.textAlign
              );
            },
            renderHTML: (attributes) => {
              const textAlign = normalizeTextAlignment(attributes.textAlign);
              if (!textAlign) {
                return {};
              }

              return {
                'data-text-align': textAlign,
                style: `text-align: ${textAlign}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextAlignment:
        (alignment) =>
        ({ dispatch, state, tr }) => {
          const textAlign = normalizeTextAlignment(alignment);
          if (!textAlign) {
            return false;
          }

          const { from, to, empty, $from } = state.selection;
          let changed = false;

          const alignNode = (position: number, node: typeof state.doc) => {
            if (!ALIGNABLE_NODE_TYPE_SET.has(node.type.name) || node.attrs.textAlign === textAlign) {
              return;
            }

            tr.setNodeMarkup(position, undefined, {
              ...node.attrs,
              textAlign,
            });
            changed = true;
          };

          if (empty) {
            for (let depth = $from.depth; depth > 0; depth -= 1) {
              const node = $from.node(depth);
              if (ALIGNABLE_NODE_TYPE_SET.has(node.type.name)) {
                alignNode($from.before(depth), node);
                break;
              }
            }
          } else {
            state.doc.nodesBetween(from, to, (node, position) => {
              alignNode(position, node);
            });
          }

          if (!changed) {
            return false;
          }

          if (dispatch) {
            dispatch(tr.scrollIntoView());
          }

          return true;
        },
    };
  },
});
