import type { JSONContent } from '@tiptap/react';
import {
  COMIC_ELEMENT_TYPES,
  ELEMENT_CYCLE,
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
};

export const MODE_ELEMENT_TYPES: Record<DocumentMode, ScreenplayElementType[]> = {
  screenplay: SCREENPLAY_ELEMENT_TYPES,
  comic: COMIC_ELEMENT_TYPES,
};

export const DEFAULT_ELEMENT_BY_MODE: Record<DocumentMode, ScreenplayElementType> = {
  screenplay: 'sceneHeading',
  comic: 'comicPage',
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

export function getDocumentSchemaContentExpression(mode: DocumentMode): string {
  if (mode === 'comic') {
    return '(comicPage | comicPanel | action | character | dialogue | parenthetical | caption | soundEffect | sceneHeading | transition | pageBreak)+';
  }

  return '(sceneHeading | action | character | dialogue | parenthetical | transition | comicPage | comicPanel | caption | soundEffect | pageBreak)+';
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

  return getPreviousScreenplayElementType(currentType, previousType);
}

export function getEnterElementType(
  mode: DocumentMode,
  currentType: ScreenplayElementType
): ScreenplayElementType {
  return mode === 'comic'
    ? getEnterComicElementType(currentType)
    : getEnterScreenplayElementType(currentType);
}
