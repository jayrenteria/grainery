import {
  COMIC_ELEMENT_TYPES,
  FREEWRITE_ELEMENT_TYPES,
  SCREENPLAY_ELEMENT_TYPES,
  type DocumentMode,
  type ScreenplayElementType,
} from './types';
import type { ElementLoopContext, ElementLoopEvent } from '../plugins';

export interface ElementLoopContextTransition {
  id: string;
  label: string;
  event: ElementLoopEvent;
  currentTypes?: ScreenplayElementType[];
  previousTypes?: string[];
  isCurrentEmpty?: boolean;
  nextType: ScreenplayElementType;
}

export interface ModeElementLoopPreferences {
  tabOrder: ScreenplayElementType[];
  enterTransitions: Partial<Record<ScreenplayElementType, ScreenplayElementType>>;
  emptyEnterTransitions: Partial<Record<ScreenplayElementType, ScreenplayElementType>>;
  escapeTarget: ScreenplayElementType;
  contextTransitions: ElementLoopContextTransition[];
}

export type ElementLoopPreferences = Record<DocumentMode, ModeElementLoopPreferences>;

const DOCUMENT_MODES: DocumentMode[] = ['screenplay', 'comic', 'freewrite'];

const MODE_ELEMENT_TYPES: Record<DocumentMode, ScreenplayElementType[]> = {
  screenplay: SCREENPLAY_ELEMENT_TYPES,
  comic: COMIC_ELEMENT_TYPES,
  freewrite: FREEWRITE_ELEMENT_TYPES,
};

const DEFAULT_TAB_ORDERS: Record<DocumentMode, ScreenplayElementType[]> = {
  screenplay: ['sceneHeading', 'action', 'character', 'transition'],
  comic: ['comicPage', 'comicPanel', 'action', 'character', 'dialogue', 'caption', 'soundEffect'],
  freewrite: ['title', 'heading', 'body', 'bulletItem', 'numberedItem'],
};

const DEFAULT_ENTER_TRANSITIONS: Record<
  DocumentMode,
  Partial<Record<ScreenplayElementType, ScreenplayElementType>>
> = {
  screenplay: {
    sceneHeading: 'action',
    action: 'action',
    character: 'dialogue',
    dialogue: 'action',
    parenthetical: 'dialogue',
    transition: 'sceneHeading',
  },
  comic: {
    comicPage: 'comicPanel',
    comicPanel: 'action',
    action: 'character',
    character: 'dialogue',
    dialogue: 'character',
    parenthetical: 'dialogue',
    caption: 'character',
    soundEffect: 'character',
  },
  freewrite: {
    title: 'body',
    heading: 'body',
    body: 'body',
    bulletItem: 'bulletItem',
    numberedItem: 'numberedItem',
  },
};

const DEFAULT_EMPTY_ENTER_TRANSITIONS: Record<
  DocumentMode,
  Partial<Record<ScreenplayElementType, ScreenplayElementType>>
> = {
  screenplay: {},
  comic: {},
  freewrite: {
    bulletItem: 'body',
    numberedItem: 'body',
  },
};

const DEFAULT_ESCAPE_TARGETS: Record<DocumentMode, ScreenplayElementType> = {
  screenplay: 'action',
  comic: 'action',
  freewrite: 'body',
};

const DEFAULT_CONTEXT_TRANSITIONS: Record<DocumentMode, ElementLoopContextTransition[]> = {
  screenplay: [
    {
      id: 'screenplay-after-character-tab-to-dialogue',
      label: 'After Character, Tab creates',
      event: 'tab',
      previousTypes: ['character'],
      currentTypes: ['sceneHeading', 'action', 'character', 'transition'],
      nextType: 'dialogue',
    },
    {
      id: 'screenplay-after-character-dialogue-tab',
      label: 'After Character, Tab from Dialogue creates',
      event: 'tab',
      previousTypes: ['character'],
      currentTypes: ['dialogue'],
      nextType: 'parenthetical',
    },
    {
      id: 'screenplay-after-character-parenthetical-tab',
      label: 'After Character, Tab from Parenthetical creates',
      event: 'tab',
      previousTypes: ['character'],
      currentTypes: ['parenthetical'],
      nextType: 'dialogue',
    },
    {
      id: 'screenplay-after-character-dialogue-shift-tab',
      label: 'After Character, Shift Tab from Dialogue creates',
      event: 'shift-tab',
      previousTypes: ['character'],
      currentTypes: ['dialogue'],
      nextType: 'parenthetical',
    },
    {
      id: 'screenplay-after-character-parenthetical-shift-tab',
      label: 'After Character, Shift Tab from Parenthetical creates',
      event: 'shift-tab',
      previousTypes: ['character'],
      currentTypes: ['parenthetical'],
      nextType: 'dialogue',
    },
    {
      id: 'screenplay-dialogue-block-shift-tab',
      label: 'Dialogue block, Shift Tab creates',
      event: 'shift-tab',
      currentTypes: ['dialogue', 'parenthetical'],
      nextType: 'character',
    },
  ],
  comic: [
    {
      id: 'comic-character-enter',
      label: 'Character leads to',
      event: 'enter',
      currentTypes: ['character'],
      nextType: 'dialogue',
    },
    {
      id: 'comic-parenthetical-enter',
      label: 'Parenthetical leads to',
      event: 'enter',
      currentTypes: ['parenthetical'],
      nextType: 'dialogue',
    },
    {
      id: 'comic-dialogue-caption-sfx-enter',
      label: 'Dialogue, Caption, or SFX leads to',
      event: 'enter',
      currentTypes: ['dialogue', 'caption', 'soundEffect'],
      nextType: 'character',
    },
  ],
  freewrite: [
    {
      id: 'freewrite-empty-list-enter',
      label: 'Empty list item leads to',
      event: 'enter',
      currentTypes: ['bulletItem', 'numberedItem'],
      isCurrentEmpty: true,
      nextType: 'body',
    },
  ],
};

function cloneModePreferences(mode: DocumentMode): ModeElementLoopPreferences {
  return {
    tabOrder: [...DEFAULT_TAB_ORDERS[mode]],
    enterTransitions: { ...DEFAULT_ENTER_TRANSITIONS[mode] },
    emptyEnterTransitions: { ...DEFAULT_EMPTY_ENTER_TRANSITIONS[mode] },
    escapeTarget: DEFAULT_ESCAPE_TARGETS[mode],
    contextTransitions: DEFAULT_CONTEXT_TRANSITIONS[mode].map((transition) => ({ ...transition })),
  };
}

export function getDefaultElementLoopPreferences(): ElementLoopPreferences {
  return {
    screenplay: cloneModePreferences('screenplay'),
    comic: cloneModePreferences('comic'),
    freewrite: cloneModePreferences('freewrite'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedInMode(mode: DocumentMode, value: unknown): value is ScreenplayElementType {
  return typeof value === 'string' && MODE_ELEMENT_TYPES[mode].includes(value as ScreenplayElementType);
}

function normalizeElementList(
  mode: DocumentMode,
  raw: unknown,
  fallback: ScreenplayElementType[]
): ScreenplayElementType[] {
  if (!Array.isArray(raw)) {
    return [...fallback];
  }

  const seen = new Set<ScreenplayElementType>();
  const values = raw.filter((value): value is ScreenplayElementType => {
    if (!isAllowedInMode(mode, value) || seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });

  return values.length > 0 ? values : [...fallback];
}

function normalizeTransitionMap(
  mode: DocumentMode,
  raw: unknown,
  fallback: Partial<Record<ScreenplayElementType, ScreenplayElementType>>
): Partial<Record<ScreenplayElementType, ScreenplayElementType>> {
  const result: Partial<Record<ScreenplayElementType, ScreenplayElementType>> = {};
  const source = isRecord(raw) ? raw : {};

  for (const elementType of MODE_ELEMENT_TYPES[mode]) {
    const storedValue = source[elementType];
    const fallbackValue = fallback[elementType];

    if (isAllowedInMode(mode, storedValue)) {
      result[elementType] = storedValue;
    } else if (fallbackValue) {
      result[elementType] = fallbackValue;
    }
  }

  return result;
}

function normalizeContextTransitions(
  mode: DocumentMode,
  raw: unknown,
  fallback: ElementLoopContextTransition[]
): ElementLoopContextTransition[] {
  const rawTransitions = Array.isArray(raw) ? raw : [];

  return fallback.map((defaultTransition) => {
    const storedTransition = rawTransitions.find((transition) => {
      return isRecord(transition) && transition.id === defaultTransition.id;
    });

    const nextType = isRecord(storedTransition) && isAllowedInMode(mode, storedTransition.nextType)
      ? storedTransition.nextType
      : defaultTransition.nextType;

    return {
      ...defaultTransition,
      nextType,
    };
  });
}

function normalizeModePreferences(mode: DocumentMode, raw: unknown): ModeElementLoopPreferences {
  const defaults = cloneModePreferences(mode);
  const source = isRecord(raw) ? raw : {};

  return {
    tabOrder: normalizeElementList(mode, source.tabOrder, defaults.tabOrder),
    enterTransitions: normalizeTransitionMap(mode, source.enterTransitions, defaults.enterTransitions),
    emptyEnterTransitions: normalizeTransitionMap(
      mode,
      source.emptyEnterTransitions,
      defaults.emptyEnterTransitions
    ),
    escapeTarget: isAllowedInMode(mode, source.escapeTarget)
      ? source.escapeTarget
      : defaults.escapeTarget,
    contextTransitions: normalizeContextTransitions(
      mode,
      source.contextTransitions,
      defaults.contextTransitions
    ),
  };
}

export function normalizeElementLoopPreferences(raw: unknown): ElementLoopPreferences {
  const source = isRecord(raw) ? raw : {};

  return DOCUMENT_MODES.reduce((preferences, mode) => {
    preferences[mode] = normalizeModePreferences(mode, source[mode]);
    return preferences;
  }, {} as ElementLoopPreferences);
}

function cycleFromOrder(
  order: ScreenplayElementType[],
  currentType: ScreenplayElementType,
  direction: 1 | -1,
  fallback: ScreenplayElementType
): ScreenplayElementType {
  const index = order.indexOf(currentType);
  if (index === -1) {
    return fallback;
  }

  return order[(index + direction + order.length) % order.length];
}

function getCycleFallback(mode: DocumentMode): ScreenplayElementType {
  return mode === 'freewrite' ? 'body' : 'action';
}

function transitionMatches(
  transition: ElementLoopContextTransition,
  context: ElementLoopContext
): boolean {
  if (transition.event !== context.event) {
    return false;
  }

  if (transition.currentTypes && !transition.currentTypes.includes(context.currentType)) {
    return false;
  }

  if (
    transition.previousTypes &&
    !transition.previousTypes.includes(context.previousType ?? '')
  ) {
    return false;
  }

  if (
    typeof transition.isCurrentEmpty === 'boolean' &&
    transition.isCurrentEmpty !== context.isCurrentEmpty
  ) {
    return false;
  }

  return true;
}

export function resolveElementLoopFromPreferences(
  context: ElementLoopContext,
  preferences: ElementLoopPreferences
): ScreenplayElementType | null {
  const modePreferences = preferences[context.documentMode];
  if (!modePreferences) {
    return null;
  }

  const contextTransition = modePreferences.contextTransitions.find((transition) =>
    transitionMatches(transition, context)
  );

  if (contextTransition) {
    return contextTransition.nextType;
  }

  if (context.event === 'tab') {
    return cycleFromOrder(
      modePreferences.tabOrder,
      context.currentType,
      1,
      getCycleFallback(context.documentMode)
    );
  }

  if (context.event === 'shift-tab') {
    return cycleFromOrder(
      modePreferences.tabOrder,
      context.currentType,
      -1,
      getCycleFallback(context.documentMode)
    );
  }

  if (context.event === 'enter') {
    if (
      context.isCurrentEmpty &&
      modePreferences.emptyEnterTransitions[context.currentType]
    ) {
      return modePreferences.emptyEnterTransitions[context.currentType] ?? null;
    }

    return modePreferences.enterTransitions[context.currentType] ?? null;
  }

  if (context.event === 'escape') {
    return modePreferences.escapeTarget;
  }

  return null;
}
