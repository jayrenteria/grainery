import type { ScreenplayElementType, CharacterExtension } from '../../lib/types';

const ELEMENT_LABELS: Record<ScreenplayElementType, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
};

const ELEMENT_HINTS: Record<ScreenplayElementType, string> = {
  sceneHeading: 'Tab to cycle • Enter for Action',
  action: 'Tab to cycle • Enter on empty for Character',
  character: 'Tab to cycle • ⌘E for extension • Enter for Dialogue',
  dialogue: 'Tab to cycle • Enter for Character',
  parenthetical: 'Tab to cycle • Enter for Dialogue',
  transition: 'Tab to cycle • Enter for Scene Heading',
};

interface ElementTypeIndicatorProps {
  currentType: ScreenplayElementType | null;
  characterExtension?: CharacterExtension;
}

export function ElementTypeIndicator({ currentType, characterExtension }: ElementTypeIndicatorProps) {
  if (!currentType || !ELEMENT_LABELS[currentType]) {
    return null;
  }

  const label = currentType === 'character' && characterExtension
    ? `${ELEMENT_LABELS[currentType]} (${characterExtension})`
    : ELEMENT_LABELS[currentType];

  return (
    <div className="element-type-indicator">
      <div className="element-type-label">{label}</div>
      <div className="element-type-hint">{ELEMENT_HINTS[currentType]}</div>
    </div>
  );
}
