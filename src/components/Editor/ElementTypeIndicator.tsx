import type { ScreenplayElementType, CharacterExtension } from '../../lib/types';

const ELEMENT_LABELS: Record<ScreenplayElementType, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
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
      <span className="element-type-dot" aria-hidden="true" />
      <span className="element-type-label">{label}</span>
    </div>
  );
}
