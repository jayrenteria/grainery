import type { JSONContent } from '@tiptap/react';
import {
  COMIC_ELEMENT_TYPES,
  ELEMENT_CYCLE,
  FREEWRITE_ELEMENT_TYPES,
  SCREENPLAY_ELEMENT_TYPES,
  type DocumentMode,
  type ScreenplayElementType,
} from './types';

export const ELEMENT_LABELS: Record<ScreenplayElementType, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  comicPage: 'Comic Page',
  comicPanel: 'Panel',
  caption: 'Caption',
  soundEffect: 'SFX',
  title: 'Title',
  heading: 'Heading',
  body: 'Body',
  bulletItem: 'Bulleted List',
  numberedItem: 'Numbered List',
};

export const MODE_ELEMENT_TYPES: Record<DocumentMode, ScreenplayElementType[]> = {
  screenplay: SCREENPLAY_ELEMENT_TYPES,
  comic: COMIC_ELEMENT_TYPES,
  freewrite: FREEWRITE_ELEMENT_TYPES,
};

export const DEFAULT_ELEMENT_BY_MODE: Record<DocumentMode, ScreenplayElementType> = {
  screenplay: 'sceneHeading',
  comic: 'comicPage',
  freewrite: 'title',
};

const SCREENPLAY_DIALOGUE_BLOCK_CYCLE: ScreenplayElementType[] = ['dialogue', 'parenthetical'];
const SCREENPLAY_NON_DIALOGUE_CYCLE: ScreenplayElementType[] = [
  'sceneHeading',
  'action',
  'character',
  'transition',
];
const COMIC_TAB_CYCLE: ScreenplayElementType[] = [
  'comicPage',
  'comicPanel',
  'action',
  'character',
  'dialogue',
  'caption',
  'soundEffect',
];
const FREEWRITE_TAB_CYCLE: ScreenplayElementType[] = [
  'title',
  'heading',
  'body',
  'bulletItem',
  'numberedItem',
];

export function isScreenplayElementType(value: string): value is ScreenplayElementType {
  return ELEMENT_CYCLE.includes(value as ScreenplayElementType);
}

export function isElementAllowedInMode(type: ScreenplayElementType, mode: DocumentMode): boolean {
  return MODE_ELEMENT_TYPES[mode].includes(type);
}

export function getDefaultContent(mode: DocumentMode): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: DEFAULT_ELEMENT_BY_MODE[mode],
        content: [],
      },
    ],
  };
}

export function getElementSeedText(type: ScreenplayElementType): string | null {
  switch (type) {
    case 'caption':
      return 'CAP: ';
    case 'soundEffect':
      return 'SFX: ';
    default:
      return null;
  }
}

export function hasOnlyElementSeedText(type: ScreenplayElementType, text: string): boolean {
  const seedText = getElementSeedText(type);
  return Boolean(seedText && text.trim() === seedText.trim());
}

export function getDocumentSchemaContentExpression(mode: DocumentMode): string {
  if (mode === 'comic') {
    return '(comicPage | comicPanel | action | character | dialogue | parenthetical | caption | soundEffect | sceneHeading | transition | pageBreak)+';
  }

  if (mode === 'freewrite') {
    return '(title | heading | body | bulletItem | numberedItem)+';
  }

  return '(sceneHeading | action | character | dialogue | parenthetical | transition | comicPage | comicPanel | caption | soundEffect | pageBreak)+';
}

export function isListElementType(type: ScreenplayElementType): boolean {
  return type === 'bulletItem' || type === 'numberedItem';
}

export function getEscapeElementType(mode: DocumentMode): ScreenplayElementType {
  return mode === 'freewrite' ? 'body' : 'action';
}

function isDialogueBlock(type: ScreenplayElementType): boolean {
  return type === 'dialogue' || type === 'parenthetical';
}

function cycle(
  values: ScreenplayElementType[],
  currentType: ScreenplayElementType,
  direction: 1 | -1,
  fallback: ScreenplayElementType
): ScreenplayElementType {
  const index = values.indexOf(currentType);
  if (index === -1) {
    return fallback;
  }
  return values[(index + direction + values.length) % values.length];
}

function getNextScreenplayElementType(
  currentType: ScreenplayElementType,
  previousType: string | null
): ScreenplayElementType {
  if (previousType === 'character') {
    if (isDialogueBlock(currentType)) {
      return cycle(SCREENPLAY_DIALOGUE_BLOCK_CYCLE, currentType, 1, 'dialogue');
    }
    return 'dialogue';
  }

  return cycle(SCREENPLAY_NON_DIALOGUE_CYCLE, currentType, 1, 'action');
}

function getPreviousScreenplayElementType(
  currentType: ScreenplayElementType,
  previousType: string | null
): ScreenplayElementType {
  if (previousType === 'character' && isDialogueBlock(currentType)) {
    return cycle(SCREENPLAY_DIALOGUE_BLOCK_CYCLE, currentType, -1, 'parenthetical');
  }

  if (isDialogueBlock(currentType)) {
    return 'character';
  }

  return cycle(SCREENPLAY_NON_DIALOGUE_CYCLE, currentType, -1, 'action');
}

function getEnterScreenplayElementType(currentType: ScreenplayElementType): ScreenplayElementType {
  switch (currentType) {
    case 'sceneHeading':
      return 'action';
    case 'character':
      return 'dialogue';
    case 'dialogue':
      return 'action';
    case 'parenthetical':
      return 'dialogue';
    case 'transition':
      return 'sceneHeading';
    case 'action':
    default:
      return 'action';
  }
}

function getEnterFreewriteElementType(
  currentType: ScreenplayElementType,
  isCurrentEmpty: boolean
): ScreenplayElementType {
  // An empty list item exits the list back to body, like typical notes apps.
  if (isListElementType(currentType)) {
    return isCurrentEmpty ? 'body' : currentType;
  }

  return 'body';
}

function getEnterComicElementType(currentType: ScreenplayElementType): ScreenplayElementType {
  switch (currentType) {
    case 'comicPage':
      return 'comicPanel';
    case 'comicPanel':
      return 'action';
    case 'action':
      return 'character';
    case 'character':
      return 'dialogue';
    case 'parenthetical':
      return 'dialogue';
    case 'dialogue':
    case 'caption':
    case 'soundEffect':
      return 'character';
    default:
      return 'action';
  }
}

export function getNextElementType(
  mode: DocumentMode,
  currentType: ScreenplayElementType,
  previousType: string | null
): ScreenplayElementType {
  if (mode === 'comic') {
    return cycle(COMIC_TAB_CYCLE, currentType, 1, 'action');
  }

  if (mode === 'freewrite') {
    return cycle(FREEWRITE_TAB_CYCLE, currentType, 1, 'body');
  }

  return getNextScreenplayElementType(currentType, previousType);
}

export function getPreviousElementType(
  mode: DocumentMode,
  currentType: ScreenplayElementType,
  previousType: string | null
): ScreenplayElementType {
  if (mode === 'comic') {
    return cycle(COMIC_TAB_CYCLE, currentType, -1, 'action');
  }

  if (mode === 'freewrite') {
    return cycle(FREEWRITE_TAB_CYCLE, currentType, -1, 'body');
  }

  return getPreviousScreenplayElementType(currentType, previousType);
}

export function getEnterElementType(
  mode: DocumentMode,
  currentType: ScreenplayElementType,
  isCurrentEmpty = false
): ScreenplayElementType {
  if (mode === 'comic') {
    return getEnterComicElementType(currentType);
  }

  if (mode === 'freewrite') {
    return getEnterFreewriteElementType(currentType, isCurrentEmpty);
  }

  return getEnterScreenplayElementType(currentType);
}
