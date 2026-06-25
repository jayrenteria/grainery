import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface InactiveSelectionState {
  focused: boolean;
  from: number | null;
  to: number | null;
}

type InactiveSelectionAction =
  | {
      type: 'focus';
      focused: boolean;
    }
  | undefined;

const DEFAULT_INACTIVE_SELECTION_STATE: InactiveSelectionState = {
  focused: true,
  from: null,
  to: null,
};

export const inactiveSelectionPluginKey = new PluginKey<InactiveSelectionState>('inactiveSelection');

function selectionRange(tr: Transaction): Pick<InactiveSelectionState, 'from' | 'to'> {
  const { from, to, empty } = tr.selection;
  if (empty) {
    return { from: null, to: null };
  }

  const maxPosition = Math.max(1, tr.doc.content.size);
  return {
    from: Math.min(Math.max(from, 1), maxPosition),
    to: Math.min(Math.max(to, 1), maxPosition),
  };
}

function mapRange(
  prev: InactiveSelectionState,
  tr: Transaction
): Pick<InactiveSelectionState, 'from' | 'to'> {
  if (prev.from === null || prev.to === null) {
    return { from: null, to: null };
  }

  const maxPosition = Math.max(1, tr.doc.content.size);
  const from = Math.min(Math.max(tr.mapping.map(prev.from, -1), 1), maxPosition);
  const to = Math.min(Math.max(tr.mapping.map(prev.to, 1), 1), maxPosition);

  return to > from ? { from, to } : { from: null, to: null };
}

function nextInactiveSelectionState(
  prev: InactiveSelectionState,
  tr: Transaction,
  action: InactiveSelectionAction
): InactiveSelectionState {
  const focused = action?.type === 'focus' ? action.focused : prev.focused;
  const range =
    tr.selectionSet || action?.type === 'focus' ? selectionRange(tr) : mapRange(prev, tr);

  return {
    focused,
    from: range.from,
    to: range.to,
  };
}

export const InactiveSelectionExtension = Extension.create({
  name: 'inactiveSelection',

  priority: 1750,

  addProseMirrorPlugins() {
    return [
      new Plugin<InactiveSelectionState>({
        key: inactiveSelectionPluginKey,
        state: {
          init: () => DEFAULT_INACTIVE_SELECTION_STATE,
          apply: (tr, prev) => {
            const action = tr.getMeta(inactiveSelectionPluginKey) as InactiveSelectionAction;
            return nextInactiveSelectionState(prev, tr, action);
          },
        },
        props: {
          handleDOMEvents: {
            focus: (view) => {
              view.dispatch(
                view.state.tr.setMeta(inactiveSelectionPluginKey, {
                  type: 'focus',
                  focused: true,
                } satisfies InactiveSelectionAction)
              );
              return false;
            },
            blur: (view) => {
              view.dispatch(
                view.state.tr.setMeta(inactiveSelectionPluginKey, {
                  type: 'focus',
                  focused: false,
                } satisfies InactiveSelectionAction)
              );
              return false;
            },
          },
          decorations: (state) => {
            const pluginState =
              inactiveSelectionPluginKey.getState(state) ?? DEFAULT_INACTIVE_SELECTION_STATE;
            if (pluginState.focused || pluginState.from === null || pluginState.to === null) {
              return DecorationSet.empty;
            }

            const maxPosition = Math.max(1, state.doc.content.size);
            const from = Math.min(Math.max(pluginState.from, 1), maxPosition);
            const to = Math.min(Math.max(pluginState.to, 1), maxPosition);
            if (to <= from) {
              return DecorationSet.empty;
            }

            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, {
                class: 'inactive-editor-selection',
              }),
            ]);
          },
        },
      }),
    ];
  },
});
