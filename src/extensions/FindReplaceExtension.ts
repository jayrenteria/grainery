import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindReplaceState {
  query: string;
  replaceWith: string;
  matchCase: boolean;
  matches: FindMatch[];
  activeIndex: number;
  isOpen: boolean;
}

type FindReplaceAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'setQuery'; query: string }
  | { type: 'setReplaceWith'; replaceWith: string }
  | { type: 'setMatchCase'; matchCase: boolean }
  | { type: 'setActiveIndex'; activeIndex: number }
  | { type: 'afterReplaceCurrent'; nextPos: number }
  | { type: 'afterReplaceAll'; nextPos: number };

const DEFAULT_FIND_REPLACE_STATE: FindReplaceState = {
  query: '',
  replaceWith: '',
  matchCase: false,
  matches: [],
  activeIndex: -1,
  isOpen: false,
};

export const findReplacePluginKey = new PluginKey<FindReplaceState>('findReplace');
const VISUALLY_UPPERCASE_NODE_TYPES = new Set(['sceneHeading', 'character', 'transition']);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      openFind: () => ReturnType;
      closeFind: () => ReturnType;
      setFindQuery: (query: string) => ReturnType;
      setReplaceText: (replaceWith: string) => ReturnType;
      toggleMatchCase: (value?: boolean) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceCurrent: () => ReturnType;
      replaceAll: () => ReturnType;
      getFindState: () => ReturnType;
    };
  }
}

function clampIndex(index: number, total: number): number {
  if (total <= 0) {
    return -1;
  }
  if (index < 0) {
    return 0;
  }
  if (index >= total) {
    return total - 1;
  }
  return index;
}

function findIndexAtOrAfter(matches: FindMatch[], pos: number): number {
  if (matches.length === 0) {
    return -1;
  }

  const nextIndex = matches.findIndex((match) => match.from >= pos || (pos > match.from && pos <= match.to));
  return nextIndex === -1 ? 0 : nextIndex;
}

function findIndexAtOrBefore(matches: FindMatch[], pos: number): number {
  if (matches.length === 0) {
    return -1;
  }

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    if (match.to <= pos || (pos >= match.from && pos <= match.to)) {
      return index;
    }
  }

  return matches.length - 1;
}

function computeMatches(doc: Transaction['doc'], query: string, matchCase: boolean): FindMatch[] {
  if (!query) {
    return [];
  }
  const matches: FindMatch[] = [];

  doc.descendants((node, pos) => {
    // Scan each text node independently so matches never cross node boundaries.
    if (!node.isText) {
      return true;
    }

    const text = node.text ?? '';
    if (!text) {
      return true;
    }

    const parentNodeType = doc.resolve(pos).parent.type.name;
    const usesVisualUppercase = VISUALLY_UPPERCASE_NODE_TYPES.has(parentNodeType);
    const haystack = matchCase
      ? (usesVisualUppercase ? text.toUpperCase() : text)
      : text.toLowerCase();
    const needle = matchCase ? query : query.toLowerCase();
    let offset = 0;

    while (offset <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, offset);
      if (found === -1) {
        break;
      }

      matches.push({
        from: pos + found,
        to: pos + found + needle.length,
      });

      offset = found + Math.max(needle.length, 1);
    }

    return true;
  });

  return matches;
}

function selectMatch(editor: Editor, index: number): boolean {
  const state = getFindReplaceState(editor);
  if (index < 0 || index >= state.matches.length) {
    return false;
  }

  const match = state.matches[index];
  const { view } = editor;
  const tr = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
    .setMeta(findReplacePluginKey, { type: 'setActiveIndex', activeIndex: index } satisfies FindReplaceAction)
    .scrollIntoView();

  view.dispatch(tr);
  editor.commands.focus();
  return true;
}

function nextStateFromAction(
  prev: FindReplaceState,
  tr: Transaction,
  action: FindReplaceAction | undefined
): FindReplaceState {
  let next: FindReplaceState = {
    ...prev,
    matches: prev.matches.slice(),
  };

  if (action) {
    switch (action.type) {
      case 'open':
        next.isOpen = true;
        break;
      case 'close':
        next.isOpen = false;
        break;
      case 'setQuery':
        next.query = action.query;
        break;
      case 'setReplaceWith':
        next.replaceWith = action.replaceWith;
        break;
      case 'setMatchCase':
        next.matchCase = action.matchCase;
        break;
      case 'setActiveIndex':
        next.activeIndex = action.activeIndex;
        break;
      default:
        break;
    }
  }

  const shouldRecomputeMatches =
    tr.docChanged ||
    action?.type === 'setQuery' ||
    action?.type === 'setMatchCase' ||
    action?.type === 'afterReplaceCurrent' ||
    action?.type === 'afterReplaceAll';

  if (shouldRecomputeMatches) {
    next.matches = computeMatches(tr.doc, next.query, next.matchCase);

    if (next.matches.length === 0) {
      next.activeIndex = -1;
    } else if (action?.type === 'setActiveIndex') {
      next.activeIndex = clampIndex(action.activeIndex, next.matches.length);
    } else if (action?.type === 'afterReplaceCurrent' || action?.type === 'afterReplaceAll') {
      next.activeIndex = findIndexAtOrAfter(next.matches, action.nextPos);
    } else if (action?.type === 'setQuery') {
      next.activeIndex = findIndexAtOrAfter(next.matches, tr.selection.from);
    } else {
      next.activeIndex = clampIndex(next.activeIndex, next.matches.length);
    }
  } else {
    next.activeIndex = clampIndex(next.activeIndex, next.matches.length);
  }

  return next;
}

export function getFindReplaceState(editor: Editor | null): FindReplaceState {
  if (!editor) {
    return DEFAULT_FIND_REPLACE_STATE;
  }

  return findReplacePluginKey.getState(editor.state) ?? DEFAULT_FIND_REPLACE_STATE;
}

export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  priority: 2000,

  addCommands() {
    return {
      openFind:
        () =>
        ({ editor, tr, dispatch }) => {
          if (!dispatch) {
            return true;
          }
          dispatch(tr.setMeta(findReplacePluginKey, { type: 'open' } satisfies FindReplaceAction));
          editor.commands.focus();
          return true;
        },
      closeFind:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            return true;
          }
          dispatch(tr.setMeta(findReplacePluginKey, { type: 'close' } satisfies FindReplaceAction));
          return true;
        },
      setFindQuery:
        (query: string) =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            return true;
          }
          dispatch(tr.setMeta(findReplacePluginKey, { type: 'setQuery', query } satisfies FindReplaceAction));
          return true;
        },
      setReplaceText:
        (replaceWith: string) =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            return true;
          }
          dispatch(
            tr.setMeta(
              findReplacePluginKey,
              { type: 'setReplaceWith', replaceWith } satisfies FindReplaceAction
            )
          );
          return true;
        },
      toggleMatchCase:
        (value?: boolean) =>
        ({ editor, tr, dispatch }) => {
          if (!dispatch) {
            return true;
          }
          const current = getFindReplaceState(editor);
          const nextValue = typeof value === 'boolean' ? value : !current.matchCase;
          dispatch(
            tr.setMeta(
              findReplacePluginKey,
              { type: 'setMatchCase', matchCase: nextValue } satisfies FindReplaceAction
            )
          );
          return true;
        },
      findNext:
        () =>
        ({ editor }) => {
          const state = getFindReplaceState(editor);
          if (state.matches.length === 0) {
            return false;
          }

          const current = clampIndex(state.activeIndex, state.matches.length);
          const index =
            current === -1
              ? findIndexAtOrAfter(state.matches, editor.state.selection.to)
              : (current + 1) % state.matches.length;

          return selectMatch(editor, index);
        },
      findPrevious:
        () =>
        ({ editor }) => {
          const state = getFindReplaceState(editor);
          if (state.matches.length === 0) {
            return false;
          }

          const current = clampIndex(state.activeIndex, state.matches.length);
          const index =
            current === -1
              ? findIndexAtOrBefore(state.matches, editor.state.selection.from)
              : (current - 1 + state.matches.length) % state.matches.length;

          return selectMatch(editor, index);
        },
      replaceCurrent:
        () =>
        ({ editor }) => {
          const state = getFindReplaceState(editor);
          if (state.matches.length === 0) {
            return false;
          }

          const normalizedIndex = clampIndex(state.activeIndex, state.matches.length);
          const index =
            normalizedIndex === -1
              ? findIndexAtOrAfter(state.matches, editor.state.selection.from)
              : normalizedIndex;
          const match = state.matches[index];
          if (!match) {
            return false;
          }

          const replacement = state.replaceWith;
          const nextPos = match.from + replacement.length;
          const tr = editor.state.tr
            .insertText(replacement, match.from, match.to)
            .setMeta(
              findReplacePluginKey,
              { type: 'afterReplaceCurrent', nextPos } satisfies FindReplaceAction
            );

          editor.view.dispatch(tr);

          const nextState = getFindReplaceState(editor);
          if (nextState.activeIndex >= 0) {
            return selectMatch(editor, nextState.activeIndex);
          }
          return true;
        },
      replaceAll:
        () =>
        ({ editor }) => {
          const state = getFindReplaceState(editor);
          if (state.matches.length === 0) {
            return false;
          }

          const replacement = state.replaceWith;
          const tr = editor.state.tr;

          for (let index = state.matches.length - 1; index >= 0; index -= 1) {
            const match = state.matches[index];
            tr.insertText(replacement, match.from, match.to);
          }

          tr.setMeta(
            findReplacePluginKey,
            { type: 'afterReplaceAll', nextPos: editor.state.selection.from } satisfies FindReplaceAction
          );
          editor.view.dispatch(tr);

          const nextState = getFindReplaceState(editor);
          if (nextState.activeIndex >= 0) {
            return selectMatch(editor, nextState.activeIndex);
          }

          return true;
        },
      getFindState:
        () =>
        () => {
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-f': () => this.editor.commands.openFind(),
      'Mod-g': () => this.editor.commands.findNext(),
      'Shift-Mod-g': () => this.editor.commands.findPrevious(),
      Escape: () => {
        const state = getFindReplaceState(this.editor);
        if (!state.isOpen) {
          return false;
        }
        return this.editor.commands.closeFind();
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplaceState>({
        key: findReplacePluginKey,
        state: {
          init: () => DEFAULT_FIND_REPLACE_STATE,
          apply: (tr, prev) => {
            const action = tr.getMeta(findReplacePluginKey) as FindReplaceAction | undefined;
            return nextStateFromAction(prev, tr, action);
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = findReplacePluginKey.getState(state) ?? DEFAULT_FIND_REPLACE_STATE;
            if (!pluginState.isOpen || !pluginState.query || pluginState.matches.length === 0) {
              return DecorationSet.empty;
            }

            const decorations = pluginState.matches.map((match, index) =>
              Decoration.inline(match.from, match.to, {
                class: index === pluginState.activeIndex ? 'find-match-active' : 'find-match',
              })
            );

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
