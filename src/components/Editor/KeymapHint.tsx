import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScreenplayElementType } from '../../lib/types';
import type { ElementLoopContext } from '../../plugins';

const HIDE_DELAY_MS = 5_000;
const HOVER_ZONE_HEIGHT = 96;
const HOVER_ZONE_MAX_WIDTH = 720;

const ELEMENT_LABELS: Record<ScreenplayElementType, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
};

const DIALOGUE_BLOCK_CYCLE: ScreenplayElementType[] = ['dialogue', 'parenthetical'];
const NON_DIALOGUE_CYCLE: ScreenplayElementType[] = [
  'sceneHeading',
  'action',
  'character',
  'transition',
];

interface KeymapHintProps {
  currentType: ScreenplayElementType | null;
  previousType: string | null;
  isCurrentEmpty: boolean;
  resolveElementLoop?: (context: ElementLoopContext) => ScreenplayElementType | null;
}

interface KeyHint {
  key: string;
  label: string;
}

function isDialogueBlock(type: ScreenplayElementType): boolean {
  return type === 'dialogue' || type === 'parenthetical';
}

function getNextElementType(currentType: ScreenplayElementType, previousType: string | null): ScreenplayElementType {
  if (previousType === 'character') {
    if (isDialogueBlock(currentType)) {
      const index = DIALOGUE_BLOCK_CYCLE.indexOf(currentType);
      return DIALOGUE_BLOCK_CYCLE[(index + 1) % DIALOGUE_BLOCK_CYCLE.length];
    }

    return 'dialogue';
  }

  const index = NON_DIALOGUE_CYCLE.indexOf(currentType);
  return index === -1 ? 'action' : NON_DIALOGUE_CYCLE[(index + 1) % NON_DIALOGUE_CYCLE.length];
}

function getPreviousElementType(currentType: ScreenplayElementType, previousType: string | null): ScreenplayElementType {
  if (previousType === 'character' && isDialogueBlock(currentType)) {
    const index = DIALOGUE_BLOCK_CYCLE.indexOf(currentType);
    return DIALOGUE_BLOCK_CYCLE[(index - 1 + DIALOGUE_BLOCK_CYCLE.length) % DIALOGUE_BLOCK_CYCLE.length];
  }

  if (isDialogueBlock(currentType)) {
    return 'character';
  }

  const index = NON_DIALOGUE_CYCLE.indexOf(currentType);
  return index === -1 ? 'action' : NON_DIALOGUE_CYCLE[(index - 1 + NON_DIALOGUE_CYCLE.length) % NON_DIALOGUE_CYCLE.length];
}

function getEnterElementType(currentType: ScreenplayElementType): ScreenplayElementType {
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

function resolveHintTarget(
  resolver: KeymapHintProps['resolveElementLoop'],
  context: ElementLoopContext,
  fallback: ScreenplayElementType
): ScreenplayElementType {
  if (!resolver) {
    return fallback;
  }

  try {
    return resolver(context) ?? fallback;
  } catch (error) {
    console.error('[KeymapHint] Plugin loop resolver failed', error);
    return fallback;
  }
}

function getKeyHints({
  currentType,
  previousType,
  isCurrentEmpty,
  resolveElementLoop,
}: KeymapHintProps): KeyHint[] {
  if (!currentType) {
    return [];
  }

  const baseContext = {
    currentType,
    previousType,
    isCurrentEmpty,
  };

  const tabTarget = resolveHintTarget(
    resolveElementLoop,
    { ...baseContext, event: 'tab' },
    getNextElementType(currentType, previousType)
  );
  const shiftTabTarget = resolveHintTarget(
    resolveElementLoop,
    { ...baseContext, event: 'shift-tab' },
    getPreviousElementType(currentType, previousType)
  );
  const enterTarget = resolveHintTarget(
    resolveElementLoop,
    { ...baseContext, event: 'enter' },
    getEnterElementType(currentType)
  );

  const hints: KeyHint[] = [
    { key: 'Tab', label: ELEMENT_LABELS[tabTarget] },
    { key: 'Shift Tab', label: ELEMENT_LABELS[shiftTabTarget] },
    { key: 'Enter', label: ELEMENT_LABELS[enterTarget] },
  ];

  const escapeTarget = resolveHintTarget(
    resolveElementLoop,
    { ...baseContext, event: 'escape' },
    'action'
  );

  if (currentType !== 'action' || escapeTarget !== 'action') {
    hints.push({ key: 'Esc', label: ELEMENT_LABELS[escapeTarget] });
  }

  if (currentType === 'character') {
    hints.push({ key: 'Cmd E', label: 'Extension' });
  }

  return hints;
}

export function KeymapHint(props: KeymapHintProps) {
  const [isVisible, setIsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPointerInZoneRef = useRef(false);

  const hints = useMemo(() => getKeyHints(props), [props]);

  useEffect(() => {
    const clearHideTimer = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const scheduleHide = () => {
      clearHideTimer();
      hideTimerRef.current = setTimeout(() => {
        setIsVisible(false);
      }, HIDE_DELAY_MS);
    };

    scheduleHide();

    const onMouseMove = (event: MouseEvent) => {
      const zoneWidth = Math.min(window.innerWidth, HOVER_ZONE_MAX_WIDTH);
      const isInZone =
        event.clientY >= window.innerHeight - HOVER_ZONE_HEIGHT &&
        Math.abs(event.clientX - window.innerWidth / 2) <= zoneWidth / 2;

      if (isInZone) {
        if (!isPointerInZoneRef.current) {
          setIsVisible(true);
        }
        isPointerInZoneRef.current = true;
        clearHideTimer();
        return;
      }

      if (isPointerInZoneRef.current) {
        isPointerInZoneRef.current = false;
        scheduleHide();
      }
    };

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      clearHideTimer();
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  if (hints.length === 0) {
    return null;
  }

  return (
    <div
      className={`keymap-hint${isVisible ? ' keymap-hint-visible' : ''}`}
      aria-hidden={!isVisible}
    >
      {hints.map((hint) => (
        <span className="keymap-hint-item" key={`${hint.key}-${hint.label}`}>
          <kbd className="keymap-hint-key">{hint.key}</kbd>
          <span className="keymap-hint-label">{hint.label}</span>
        </span>
      ))}
    </div>
  );
}
