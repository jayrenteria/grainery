import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentMode, ScreenplayElementType } from '../../lib/types';
import {
  ELEMENT_LABELS,
  getEnterElementType,
  getEscapeElementType,
  getNextElementType,
  getPreviousElementType,
} from '../../lib/elementConfig';
import type { ElementLoopContext } from '../../plugins';

const HIDE_DELAY_MS = 5_000;
const HOVER_ZONE_HEIGHT = 96;
const HOVER_ZONE_MAX_WIDTH = 720;

interface KeymapHintProps {
  documentMode: DocumentMode;
  currentType: ScreenplayElementType | null;
  previousType: string | null;
  isCurrentEmpty: boolean;
  resolveElementLoop?: (context: ElementLoopContext) => ScreenplayElementType | null;
}

interface KeyHint {
  key: string;
  label: string;
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
  documentMode,
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
    documentMode,
    previousType,
    isCurrentEmpty,
  };

  const tabTarget = resolveHintTarget(
    resolveElementLoop,
    { ...baseContext, event: 'tab' },
    getNextElementType(documentMode, currentType, previousType)
  );
  const shiftTabTarget = resolveHintTarget(
    resolveElementLoop,
    { ...baseContext, event: 'shift-tab' },
    getPreviousElementType(documentMode, currentType, previousType)
  );
  const enterTarget = resolveHintTarget(
    resolveElementLoop,
    { ...baseContext, event: 'enter' },
    getEnterElementType(documentMode, currentType, isCurrentEmpty)
  );

  const hints: KeyHint[] = [
    { key: 'Tab', label: ELEMENT_LABELS[tabTarget] },
    { key: 'Shift Tab', label: ELEMENT_LABELS[shiftTabTarget] },
    { key: 'Enter', label: ELEMENT_LABELS[enterTarget] },
  ];

  const escapeFallback = getEscapeElementType(documentMode);
  const escapeTarget = resolveHintTarget(
    resolveElementLoop,
    { ...baseContext, event: 'escape' },
    escapeFallback
  );

  if (currentType !== escapeFallback || escapeTarget !== escapeFallback) {
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
