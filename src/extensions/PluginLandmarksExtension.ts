import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { RenderedEditorLandmark } from '../plugins';

interface GutterLandmark {
  id: string;
  gutterLabel: string;
  from: number;
  to: number;
}

type GutterLandmarkInput = Pick<
  RenderedEditorLandmark,
  'id' | 'gutterLabel' | 'from' | 'to'
>;

interface PluginLandmarksState {
  landmarks: GutterLandmark[];
  decorations: DecorationSet;
  needsRebuild: boolean;
}

type PluginLandmarksAction =
  | { type: 'set'; landmarks: GutterLandmark[] }
  | undefined;

const DEFAULT_STATE: PluginLandmarksState = {
  landmarks: [],
  decorations: DecorationSet.empty,
  needsRebuild: false,
};

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
  landmarks: readonly GutterLandmarkInput[],
  maxPosition: number
): GutterLandmark[] {
  const normalized: GutterLandmark[] = [];

  for (const landmark of landmarks) {
    if (!landmark.gutterLabel || !Number.isFinite(landmark.from) || !Number.isFinite(landmark.to)) {
      continue;
    }

    const from = Math.floor(Number(landmark.from));
    const to = Math.floor(Number(landmark.to));
    if (from < 0 || to <= from || to > maxPosition) {
      continue;
    }

    normalized.push({
      id: landmark.id,
      gutterLabel: landmark.gutterLabel,
      from,
      to,
    });
  }

  return normalized;
}

function haveSameGutterRenderState(
  current: GutterLandmark[],
  next: GutterLandmark[]
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  return current.every(
    (landmark, index) =>
      landmark.id === next[index].id &&
      landmark.gutterLabel === next[index].gutterLabel &&
      landmark.from === next[index].from &&
      landmark.to === next[index].to
  );
}

function mapGutterLandmarks(
  landmarks: GutterLandmark[],
  tr: Transaction
): GutterLandmark[] {
  return landmarks.map((landmark) => ({
    ...landmark,
    from: tr.mapping.map(landmark.from, 1),
    to: tr.mapping.map(landmark.to, -1),
  }));
}

function createGutterWidget(label: string, side: 'left' | 'right'): HTMLElement {
  const element = document.createElement('span');
  element.className = `plugin-gutter-label plugin-gutter-label-${side}`;
  element.textContent = label;
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('contenteditable', 'false');
  return element;
}

function createGutterDecorations(
  doc: Transaction['doc'],
  landmarks: GutterLandmark[]
): DecorationSet {
  const decorations: Decoration[] = [];

  for (const landmark of landmarks) {
    const { from, to } = landmark;
    const node = doc.nodeAt(from);
    if (!node || from + node.nodeSize !== to || !landmark.gutterLabel) {
      continue;
    }

    const label = landmark.gutterLabel;
    decorations.push(
      Decoration.node(from, to, {
        class: 'plugin-gutter-label-host',
        'data-plugin-landmark-id': landmark.id,
      }),
      Decoration.widget(
        Math.min(from + 1, to - 1),
        () => createGutterWidget(label, 'left'),
        {
          side: -1,
          key: `${landmark.id}:${label}:left`,
          ignoreSelection: true,
        }
      ),
      Decoration.widget(
        Math.max(from + 1, to - 1),
        () => createGutterWidget(label, 'right'),
        {
          side: 1,
          key: `${landmark.id}:${label}:right`,
          ignoreSelection: true,
        }
      )
    );
  }

  return DecorationSet.create(doc, decorations);
}

export const PluginLandmarksExtension = Extension.create({
  name: 'pluginLandmarks',

  priority: 1790,

  addCommands() {
    return {
      setPluginLandmarks:
        (landmarks: RenderedEditorLandmark[]) =>
        ({ state, tr, dispatch }) => {
          const normalized = normalizeLandmarks(landmarks, state.doc.content.size);
          const current = pluginLandmarksPluginKey.getState(state) ?? DEFAULT_STATE;
          if (
            !current.needsRebuild &&
            haveSameGutterRenderState(current.landmarks, normalized)
          ) {
            return true;
          }

          if (!dispatch) {
            return true;
          }

          dispatch(
            tr.setMeta(pluginLandmarksPluginKey, {
              type: 'set',
              landmarks: normalized,
            } satisfies PluginLandmarksAction).setMeta('addToHistory', false)
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
            if (action?.type === 'set') {
              const landmarks = normalizeLandmarks(action.landmarks, tr.doc.content.size);
              if (
                !previous.needsRebuild &&
                haveSameGutterRenderState(previous.landmarks, landmarks)
              ) {
                return previous;
              }

              return {
                landmarks,
                decorations: createGutterDecorations(tr.doc, landmarks),
                needsRebuild: false,
              };
            }

            if (!tr.docChanged || previous.landmarks.length === 0) {
              return previous;
            }

            let needsRebuild =
              previous.needsRebuild || previous.decorations === DecorationSet.empty;
            const decorations = previous.decorations.map(tr.mapping, tr.doc, {
              onRemove: () => {
                needsRebuild = true;
              },
            });

            return {
              ...previous,
              landmarks: mapGutterLandmarks(previous.landmarks, tr),
              decorations,
              needsRebuild,
            };
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = pluginLandmarksPluginKey.getState(state) ?? DEFAULT_STATE;
            return pluginState.decorations;
          },
        },
      }),
    ];
  },
});

export { getPluginLandmarksState };
