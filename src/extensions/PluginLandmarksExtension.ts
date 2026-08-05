import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { RenderedEditorLandmark } from '../plugins';

interface PluginLandmarksState {
  landmarks: RenderedEditorLandmark[];
}

type PluginLandmarksAction =
  | { type: 'set'; landmarks: RenderedEditorLandmark[] }
  | undefined;

const DEFAULT_STATE: PluginLandmarksState = { landmarks: [] };

export const pluginLandmarksPluginKey = new PluginKey<PluginLandmarksState>('pluginLandmarks');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pluginLandmarks: {
      setPluginLandmarks: (landmarks: RenderedEditorLandmark[]) => ReturnType;
    };
  }
}

function getPluginLandmarksState(editor: Editor | null): PluginLandmarksState {
  if (!editor) {
    return DEFAULT_STATE;
  }
  return pluginLandmarksPluginKey.getState(editor.state) ?? DEFAULT_STATE;
}

function normalizeLandmarks(
  landmarks: RenderedEditorLandmark[],
  maxPosition: number
): RenderedEditorLandmark[] {
  return landmarks.filter((landmark) => {
    if (!landmark.gutterLabel || !Number.isFinite(landmark.from) || !Number.isFinite(landmark.to)) {
      return false;
    }

    const from = Math.floor(Number(landmark.from));
    const to = Math.floor(Number(landmark.to));
    return from >= 0 && to > from && to <= maxPosition;
  });
}

function createGutterWidget(label: string, side: 'left' | 'right'): HTMLElement {
  const element = document.createElement('span');
  element.className = `plugin-gutter-label plugin-gutter-label-${side}`;
  element.textContent = label;
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('contenteditable', 'false');
  return element;
}

export const PluginLandmarksExtension = Extension.create({
  name: 'pluginLandmarks',

  priority: 1790,

  addCommands() {
    return {
      setPluginLandmarks:
        (landmarks: RenderedEditorLandmark[]) =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            return true;
          }

          dispatch(
            tr.setMeta(pluginLandmarksPluginKey, {
              type: 'set',
              landmarks,
            } satisfies PluginLandmarksAction)
          );
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginLandmarksState>({
        key: pluginLandmarksPluginKey,
        state: {
          init: () => DEFAULT_STATE,
          apply: (tr: Transaction, previous) => {
            const action = tr.getMeta(pluginLandmarksPluginKey) as PluginLandmarksAction;
            if (!action || action.type !== 'set') {
              return previous;
            }

            return {
              landmarks: normalizeLandmarks(action.landmarks, tr.doc.content.size),
            };
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = pluginLandmarksPluginKey.getState(state) ?? DEFAULT_STATE;
            if (pluginState.landmarks.length === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            for (const landmark of pluginState.landmarks) {
              const from = Math.floor(Number(landmark.from));
              const to = Math.floor(Number(landmark.to));
              const node = state.doc.nodeAt(from);
              if (!node || from + node.nodeSize !== to || !landmark.gutterLabel) {
                continue;
              }

              decorations.push(
                Decoration.node(from, to, {
                  class: 'plugin-gutter-label-host',
                  'data-plugin-landmark-id': landmark.id,
                }),
                Decoration.widget(
                  Math.min(from + 1, to - 1),
                  () => createGutterWidget(landmark.gutterLabel as string, 'left'),
                  { side: -1, key: `${landmark.id}:left` }
                ),
                Decoration.widget(
                  Math.max(from + 1, to - 1),
                  () => createGutterWidget(landmark.gutterLabel as string, 'right'),
                  { side: 1, key: `${landmark.id}:right` }
                )
              );
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export { getPluginLandmarksState };
