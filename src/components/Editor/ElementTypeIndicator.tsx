import type { ScreenplayElementType, CharacterExtension } from '../../lib/types';
import { ELEMENT_LABELS } from '../../lib/elementConfig';

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
    <div className="element-type-indicator" data-element-type={currentType}>
      <span className="element-type-dot" aria-hidden="true" />
      <span className="element-type-label">{label}</span>
    </div>
  );
}
