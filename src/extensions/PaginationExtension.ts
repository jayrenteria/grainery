import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { computePagination, type PageBreakInfo } from '../lib/computePagination';

export interface PaginationStorage {
  breaks: PageBreakInfo[];
  totalPages: number;
}

export const paginationPluginKey = new PluginKey<{
  decorationSet: DecorationSet;
  breaks: PageBreakInfo[];
  totalPages: number;
}>('pagination');

export const PaginationExtension = Extension.create({
  name: 'pagination',

  addStorage(): PaginationStorage {
    return {
      breaks: [],
      totalPages: 1,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: paginationPluginKey,

        state: {
          init(_, { doc }) {
            const { breaks, totalPages } = computePagination(doc);
            const decorations = createPageBreakDecorations(breaks);
            return {
              decorationSet: DecorationSet.create(doc, decorations),
              breaks,
              totalPages,
            };
          },

          apply(tr, prev, _oldState, newState) {
            // Only recompute if document changed
            if (!tr.docChanged) {
              // Map decorations through the transaction
              return {
                ...prev,
                decorationSet: prev.decorationSet.map(tr.mapping, newState.doc),
              };
            }

            const { breaks, totalPages } = computePagination(newState.doc);
            const decorations = createPageBreakDecorations(breaks);

            return {
              decorationSet: DecorationSet.create(newState.doc, decorations),
              breaks,
              totalPages,
            };
          },
        },

        props: {
          decorations(state) {
            const pluginState = paginationPluginKey.getState(state);
            return pluginState?.decorationSet ?? DecorationSet.empty;
          },
        },

        view(editorView) {
          const updateStorage = () => {
            const pluginState = paginationPluginKey.getState(editorView.state);
            if (pluginState) {
              extension.storage.breaks = pluginState.breaks;
              extension.storage.totalPages = pluginState.totalPages;
            }
          };

          updateStorage();

          return {
            update() {
              updateStorage();
            },
          };
        },
      }),
    ];
  },
});

function createPageBreakDecorations(breaks: PageBreakInfo[]): Decoration[] {
  return breaks
    .filter((br) => !br.isManual) // Manual breaks are rendered by the PageBreak node itself
    .map((br) => {
      return Decoration.widget(
        br.pos,
        () => {
          const el = document.createElement('div');
          el.className = 'page-break-auto';
          el.dataset.page = String(br.page);
          el.setAttribute('contenteditable', 'false');
          
          const label = document.createElement('span');
          label.className = 'page-break-label';
          label.textContent = `Page ${br.page}`;
          el.appendChild(label);
          
          return el;
        },
        {
          side: -1, // Insert before the node at this position
          key: `page-break-${br.pos}`,
        }
      );
    });
}
