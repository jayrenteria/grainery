import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface SceneHeadingOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneHeading: {
      setSceneHeading: () => ReturnType;
    };
  }
}

// Matches INT., EXT., INT./EXT., I/E. at the start of a line
const SCENE_HEADING_REGEX = /^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)\s$/;

export const SceneHeading = Node.create<SceneHeadingOptions>({
  name: 'sceneHeading',
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      sceneNumber: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="scene-heading"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'scene-heading', class: 'scene-heading' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setSceneHeading:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-1': () => this.editor.commands.setSceneHeading(),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: SCENE_HEADING_REGEX,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const start = range.from;
          const end = range.to;
          const text = match[1] + ' ';

          tr.setBlockType(start, end, this.type);
          tr.insertText(text, start, end);
        },
      }),
    ];
  },
});
