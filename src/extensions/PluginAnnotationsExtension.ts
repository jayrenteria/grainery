import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { RenderedInlineAnnotation } from '../plugins';

interface PluginAnnotationsState {
  annotations: RenderedInlineAnnotation[];
}

type PluginAnnotationsAction =
  | {
      type: 'set';
      annotations: RenderedInlineAnnotation[];
    }
  | undefined;

const DEFAULT_PLUGIN_ANNOTATIONS_STATE: PluginAnnotationsState = {
  annotations: [],
};

export const pluginAnnotationsPluginKey = new PluginKey<PluginAnnotationsState>('pluginAnnotations');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pluginAnnotations: {
      setPluginAnnotations: (annotations: RenderedInlineAnnotation[]) => ReturnType;
    };
  }
}

function getPluginAnnotationsState(editor: Editor | null): PluginAnnotationsState {
  if (!editor) {
    return DEFAULT_PLUGIN_ANNOTATIONS_STATE;
  }

  return pluginAnnotationsPluginKey.getState(editor.state) ?? DEFAULT_PLUGIN_ANNOTATIONS_STATE;
}

function normalizeAnnotationsForDoc(
  annotations: RenderedInlineAnnotation[],
  maxPosition: number
): RenderedInlineAnnotation[] {
  const normalized: RenderedInlineAnnotation[] = [];

  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== 'object') {
      continue;
    }

    if (typeof annotation.id !== 'string' || annotation.id.trim().length === 0) {
      continue;
    }

    const rawFrom = Number(annotation.from);
    const rawTo = Number(annotation.to);

    if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) {
      continue;
    }

    const from = Math.min(Math.max(Math.floor(rawFrom), 1), maxPosition);
    const to = Math.min(Math.max(Math.floor(rawTo), 1), maxPosition);

    if (to <= from) {
      continue;
    }

    normalized.push({
      ...annotation,
      from,
      to,
      kind: annotation.kind === 'note-active' ? 'note-active' : 'note',
    });
  }

  return normalized;
}

function nextStateFromAction(
  prev: PluginAnnotationsState,
  tr: Transaction,
  action: PluginAnnotationsAction
): PluginAnnotationsState {
  if (!action || action.type !== 'set') {
    return prev;
  }

  const maxPosition = Math.max(1, tr.doc.content.size);
  return {
    annotations: normalizeAnnotationsForDoc(action.annotations, maxPosition),
  };
}

function classForAnnotation(annotation: RenderedInlineAnnotation): string {
  return annotation.kind === 'note-active'
    ? 'plugin-inline-annotation plugin-inline-annotation-active'
    : 'plugin-inline-annotation';
}

export const PluginAnnotationsExtension = Extension.create({
  name: 'pluginAnnotations',

  priority: 1800,

  addCommands() {
    return {
      setPluginAnnotations:
        (annotations: RenderedInlineAnnotation[]) =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            return true;
          }

          dispatch(
            tr.setMeta(pluginAnnotationsPluginKey, {
              type: 'set',
              annotations,
            } satisfies PluginAnnotationsAction)
          );

          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginAnnotationsState>({
        key: pluginAnnotationsPluginKey,
        state: {
          init: () => DEFAULT_PLUGIN_ANNOTATIONS_STATE,
          apply: (tr, prev) => {
            const action = tr.getMeta(pluginAnnotationsPluginKey) as PluginAnnotationsAction;
            return nextStateFromAction(prev, tr, action);
          },
        },
        props: {
          decorations: (state) => {
            const pluginState =
              pluginAnnotationsPluginKey.getState(state) ?? DEFAULT_PLUGIN_ANNOTATIONS_STATE;
            if (pluginState.annotations.length === 0) {
              return DecorationSet.empty;
            }

            const maxPosition = Math.max(1, state.doc.content.size);
            const decorations = pluginState.annotations
              .map((annotation) => {
                const from = Math.min(Math.max(Math.floor(annotation.from), 1), maxPosition);
                const to = Math.min(Math.max(Math.floor(annotation.to), 1), maxPosition);
                if (to <= from) {
                  return null;
                }

                return Decoration.inline(from, to, {
                  class: classForAnnotation(annotation),
                  'data-plugin-annotation-id': annotation.id,
                  'data-plugin-id': annotation.pluginId,
                });
              })
              .filter((decoration): decoration is Decoration => Boolean(decoration));

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export { getPluginAnnotationsState };
