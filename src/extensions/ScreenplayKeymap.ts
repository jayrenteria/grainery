import { Extension } from '@tiptap/core';
import { ELEMENT_CYCLE, type ScreenplayElementType } from '../lib/types';

// Dialogue block cycles only between dialogue and parenthetical
const DIALOGUE_BLOCK_CYCLE: ScreenplayElementType[] = ['dialogue', 'parenthetical'];

function isInDialogueBlock(currentType: string): boolean {
  return currentType === 'dialogue' || currentType === 'parenthetical';
}

function getNextElementType(currentType: string): ScreenplayElementType {
  // If in dialogue block, cycle within dialogue/parenthetical only
  if (isInDialogueBlock(currentType)) {
    const index = DIALOGUE_BLOCK_CYCLE.indexOf(currentType as ScreenplayElementType);
    return DIALOGUE_BLOCK_CYCLE[(index + 1) % DIALOGUE_BLOCK_CYCLE.length];
  }
  
  const index = ELEMENT_CYCLE.indexOf(currentType as ScreenplayElementType);
  if (index === -1) return 'action';
  return ELEMENT_CYCLE[(index + 1) % ELEMENT_CYCLE.length];
}

function getPreviousElementType(currentType: string): ScreenplayElementType {
  // If in dialogue block, cycle within dialogue/parenthetical only
  if (isInDialogueBlock(currentType)) {
    const index = DIALOGUE_BLOCK_CYCLE.indexOf(currentType as ScreenplayElementType);
    return DIALOGUE_BLOCK_CYCLE[(index - 1 + DIALOGUE_BLOCK_CYCLE.length) % DIALOGUE_BLOCK_CYCLE.length];
  }
  
  const index = ELEMENT_CYCLE.indexOf(currentType as ScreenplayElementType);
  if (index === -1) return 'action';
  return ELEMENT_CYCLE[(index - 1 + ELEMENT_CYCLE.length) % ELEMENT_CYCLE.length];
}

export const ScreenplayKeymap = Extension.create({
  name: 'screenplayKeymap',
  
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const nextType = getNextElementType(currentNode.type.name);
        return editor.commands.setNode(nextType);
      },
      'Shift-Tab': ({ editor }) => {
        const { $from } = editor.state.selection;
        const currentNode = $from.parent;
        const prevType = getPreviousElementType(currentNode.type.name);
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
