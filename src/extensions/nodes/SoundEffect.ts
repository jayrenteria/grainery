import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface SoundEffectOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    soundEffect: {
      setSoundEffect: () => ReturnType;
    };
  }
}

const SOUND_EFFECT_REGEX = /^(SFX:)\s?$/i;

export const SoundEffect = Node.create<SoundEffectOptions>({
  name: 'soundEffect',
  group: 'block',
  content: 'text*',
  marks: 'bold italic underline',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sound-effect"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'sound-effect', class: 'sound-effect' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setSoundEffect:
        () =>
        ({ commands, state }) => {
          const shouldSeed = state.selection.$from.parent.textContent.trim().length === 0;
          return commands.setNode(this.name) && (!shouldSeed || commands.insertContent('SFX: '));
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: SOUND_EFFECT_REGEX,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.setBlockType(range.from, range.to, this.type);
          tr.insertText('SFX: ', range.from, range.to);
        },
      }),
    ];
  },
});
