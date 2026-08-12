import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
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
  viewportRevision: number;
}

interface ViewportAnchor {
  container: HTMLElement;
  top: number;
}

type PluginLandmarksAction =
  | { type: 'set'; landmarks: GutterLandmark[] }
  | undefined;

const DEFAULT_STATE: PluginLandmarksState = {
  landmarks: [],
  decorations: DecorationSet.empty,
  needsRebuild: false,
  viewportRevision: 0,
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

function getScrollContainer(view: EditorView): HTMLElement | null {
  const candidate = view.dom.closest('.paginated-editor-container');
  if (
    !candidate ||
    typeof (candidate as HTMLElement).scrollTop !== 'number' ||
    typeof (candidate as HTMLElement).scrollTo !== 'function'
  ) {
    return null;
  }

  return candidate as HTMLElement;
}

function captureViewportAnchor(view: EditorView): ViewportAnchor | null {
  const container = getScrollContainer(view);
  if (!container) {
    return null;
  }

  try {
    return {
      container,
      top: view.coordsAtPos(view.state.selection.head).top,
    };
  } catch {
    return null;
  }
}

function restoreViewportAnchor(view: EditorView, anchor: ViewportAnchor | null): void {
  if (!anchor || getScrollContainer(view) !== anchor.container) {
    return;
  }

  try {
    const currentTop = view.coordsAtPos(view.state.selection.head).top;
    const nextScrollTop = anchor.container.scrollTop + currentTop - anchor.top;
    if (!Number.isFinite(nextScrollTop)) {
      return;
    }

    anchor.container.scrollTo({
      top: Math.max(0, nextScrollTop),
      behavior: 'auto',
    });
  } catch {
    // Ignore transient coordinate errors while ProseMirror updates the view.
  }
}

function restoreViewportAnchorAfterUpdate(
  view: EditorView,
  anchor: ViewportAnchor | null
): void {
  restoreViewportAnchor(view, anchor);

  const ownerWindow = view.dom.ownerDocument?.defaultView;
  if (!ownerWindow?.requestAnimationFrame) {
    return;
  }

  ownerWindow.requestAnimationFrame(() => {
    restoreViewportAnchor(view, anchor);
  });
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
                viewportRevision: previous.viewportRevision + 1,
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
        view: (view) => {
          let viewportAnchor = captureViewportAnchor(view);

          return {
            update: (nextView, previousState) => {
              const previous = pluginLandmarksPluginKey.getState(previousState) ?? DEFAULT_STATE;
              const current =
                pluginLandmarksPluginKey.getState(nextView.state) ?? DEFAULT_STATE;

              if (
                (!previous.needsRebuild && current.needsRebuild) ||
                previous.viewportRevision !== current.viewportRevision
              ) {
                restoreViewportAnchorAfterUpdate(nextView, viewportAnchor);
              }

              viewportAnchor = captureViewportAnchor(nextView);
            },
            destroy: () => {
              viewportAnchor = null;
            },
          };
        },
      }),
    ];
  },
});

export { getPluginLandmarksState };
