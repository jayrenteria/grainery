import { Extension } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { ELEMENT_CYCLE, type ScreenplayElementType } from '../lib/types';

// Dialogue block cycles only between dialogue and parenthetical
const DIALOGUE_BLOCK_CYCLE: ScreenplayElementType[] = ['dialogue', 'parenthetical'];

// Non-dialogue cycle excludes dialogue and parenthetical (only available after character)
const NON_DIALOGUE_CYCLE: ScreenplayElementType[] = [
  'sceneHeading',
  'action',
  'character',
  'transition',
];

function getPreviousNodeType($from: ResolvedPos): string | null {
  const doc = $from.doc;
  const currentIndex = $from.index($from.depth - 1);
  if (currentIndex > 0) {
    const prevNode = doc.child(currentIndex - 1);
    return prevNode.type.name;
  }
  return null;
}

function isInDialogueBlock(currentType: string): boolean {
  return currentType === 'dialogue' || currentType === 'parenthetical';
}

function getNextElementType(currentType: string, prevNodeType: string | null): ScreenplayElementType {
  // Only allow dialogue/parenthetical cycling if previous node is character
  if (prevNodeType === 'character') {
    // If already in dialogue block, cycle within it
    if (isInDialogueBlock(currentType)) {
      const index = DIALOGUE_BLOCK_CYCLE.indexOf(currentType as ScreenplayElementType);
      return DIALOGUE_BLOCK_CYCLE[(index + 1) % DIALOGUE_BLOCK_CYCLE.length];
    }
    // If on any other element after character, can enter dialogue block
    return 'dialogue';
  }
  
  // All other elements use non-dialogue cycle (excludes dialogue/parenthetical)
  const index = NON_DIALOGUE_CYCLE.indexOf(currentType as ScreenplayElementType);
  if (index === -1) return 'action';
  return NON_DIALOGUE_CYCLE[(index + 1) % NON_DIALOGUE_CYCLE.length];
}

function getPreviousElementType(currentType: string, prevNodeType: string | null): ScreenplayElementType {
  // If previous node is character and we're in dialogue block, cycle within it
  if (prevNodeType === 'character' && isInDialogueBlock(currentType)) {
    const index = DIALOGUE_BLOCK_CYCLE.indexOf(currentType as ScreenplayElementType);
    return DIALOGUE_BLOCK_CYCLE[(index - 1 + DIALOGUE_BLOCK_CYCLE.length) % DIALOGUE_BLOCK_CYCLE.length];
  }
  
  // Dialogue going backwards should go to character (back out of dialogue block)
  if (isInDialogueBlock(currentType)) {
    return 'character';
  }
  
  // All other elements use non-dialogue cycle (excludes dialogue/parenthetical)
  const index = NON_DIALOGUE_CYCLE.indexOf(currentType as ScreenplayElementType);
  if (index === -1) return 'action';
  return NON_DIALOGUE_CYCLE[(index - 1 + NON_DIALOGUE_CYCLE.length) % NON_DIALOGUE_CYCLE.length];
}

export const ScreenplayKeymap = Extension.create({
  name: 'screenplayKeymap',
  
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const prevNodeType = getPreviousNodeType($from);
        const nextType = getNextElementType(currentNode.type.name, prevNodeType);
        return editor.commands.setNode(nextType);
      },
      'Shift-Tab': ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const prevNodeType = getPreviousNodeType($from);
        const prevType = getPreviousElementType(currentNode.type.name, prevNodeType);
        return editor.commands.setNode(prevType);
      },
      // Escape returns to Action element
      Escape: ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentType = $from.parent.type.name;
        if (currentType !== 'action' && ELEMENT_CYCLE.includes(currentType as ScreenplayElementType)) {
          return editor.commands.setNode('action');
        }
        return false;
      },
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const currentType = currentNode.type.name;

        // Only handle special cases for screenplay elements
        if (!ELEMENT_CYCLE.includes(currentType as ScreenplayElementType)) {
          return false;
        }

        // Smart enter behavior based on current element
        let nextType: ScreenplayElementType;
        switch (currentType) {
          case 'sceneHeading':
            nextType = 'action';
            break;
          case 'character':
            // After character, enter dialogue block
            nextType = 'dialogue';
            break;
          case 'dialogue':
            nextType = 'action';
            break;
          case 'parenthetical':
            // Exit dialogue block, go to action
            nextType = 'dialogue';
            break;
          case 'transition':
            nextType = 'sceneHeading';
            break;
          case 'action':
          default:
            nextType = 'action';
            break;
        }

        // Insert a new block after the current one using insertContentAt
        const endPos = $from.end();
        
        return editor.chain()
          .insertContentAt(endPos + 1, { type: nextType })
          .focus()
          .run();
      },

    };
  },
});
