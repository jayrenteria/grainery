import { Node, mergeAttributes } from '@tiptap/core';
import type { CharacterExtension } from '../../lib/types';

export interface CharacterOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    character: {
      setCharacter: (attrs?: { extension?: CharacterExtension }) => ReturnType;
      setCharacterExtension: (extension: CharacterExtension) => ReturnType;
      cycleCharacterExtension: () => ReturnType;
    };
  }
}

const EXTENSIONS: CharacterExtension[] = [null, 'V.O.', 'O.S.', "CONT'D", 'O.C.'];

export const Character = Node.create<CharacterOptions>({
  name: 'character',
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
      extension: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-extension'),
        renderHTML: (attributes) => {
          if (!attributes.extension) return {};
          return { 'data-extension': attributes.extension };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="character"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const extension = node.attrs.extension;
    const attrs = mergeAttributes(
      { 'data-type': 'character', class: 'character' },
      this.options.HTMLAttributes,
      HTMLAttributes
    );

    if (extension) {
      // Render with extension span
      return [
        'div',
        attrs,
        ['span', { class: 'character-name' }, 0],
        ['span', { class: 'character-extension' }, ` (${extension})`],
      ];
    }

    return ['div', attrs, 0];
  },

  addCommands() {
    return {
      setCharacter:
        (attrs) =>
        ({ commands }) => {
          return commands.setNode(this.name, attrs);
        },
      setCharacterExtension:
        (extension) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { extension });
        },
      cycleCharacterExtension:
        () =>
        ({ editor, commands }) => {
          const { $from } = editor.state.selection;
          const node = $from.parent;
          if (node.type.name !== 'character') return false;

          const currentExt = node.attrs.extension as CharacterExtension;
          const currentIndex = EXTENSIONS.indexOf(currentExt);
          const nextIndex = (currentIndex + 1) % EXTENSIONS.length;
          const nextExt = EXTENSIONS[nextIndex];

          return commands.updateAttributes(this.name, { extension: nextExt });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-3': () => this.editor.commands.setCharacter(),
      // Ctrl/Cmd + E to cycle through extensions
      'Mod-e': () => {
        const { $from } = this.editor.state.selection;
        if ($from.parent.type.name === 'character') {
          return this.editor.commands.cycleCharacterExtension();
        }
        return false;
      },
    };
  },
});
