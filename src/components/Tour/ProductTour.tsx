import { useEffect, useMemo, useRef, useState } from 'react';
import { ELEMENT_LABELS, MODE_ELEMENT_TYPES } from '../../lib/elementConfig';
import type { DocumentMode, ScreenplayElementType } from '../../lib/types';

interface ProductTourProps {
  documentMode: DocumentMode;
  onClose: () => void;
}

interface TourStep {
  title: string;
  body: string;
  target?: string;
  showElements?: boolean;
}

const MODE_LABELS: Record<DocumentMode, string> = {
  screenplay: 'Screenplay',
  comic: 'Comic',
  freewrite: 'Free Write',
};

const ELEMENT_DESCRIPTIONS: Record<ScreenplayElementType, string> = {
  sceneHeading: 'Where and when a scene takes place.',
  action: 'What the audience sees and hears.',
  character: 'Who is about to speak.',
  dialogue: 'The words a character speaks.',
  parenthetical: 'A brief direction for how a line is delivered.',
  transition: 'How the story moves from one scene to the next.',
  comicPage: 'Starts a new comic page.',
  comicPanel: 'Sets up a new panel.',
  caption: 'Narration or text outside spoken dialogue.',
  soundEffect: 'A sound called out on the page.',
  title: 'The document’s main title.',
  heading: 'A section heading.',
  body: 'Regular free-writing text.',
  bulletItem: 'An unordered list item.',
  numberedItem: 'An ordered list item.',
};

function getSteps(documentMode: DocumentMode): TourStep[] {
  const modeLabel = MODE_LABELS[documentMode];

  return [
    {
      title: `Welcome to ${modeLabel}`,
      body: 'Here is a quick look at the controls that keep formatting out of your way while you write.',
    },
    {
      title: 'Know your current element',
      body: 'This indicator always shows the type of the element containing your cursor.',
      target: '[data-tour="element-type-indicator"]',
    },
    {
      title: 'Keyboard hints stay close',
      body: 'These hints change with the current element. They fade after five seconds by default; turn on Keep keyboard hints visible in Settings → Editor to pin them.',
      target: '[data-tour="keymap-hint"]',
    },
    ...(documentMode === 'screenplay'
      ? [{
          title: 'Continue dialogue naturally',
          body: 'After Dialogue, press Enter. From the empty Action, press Shift+Tab to add a Parenthetical, then Enter to continue Dialogue. Press Tab instead when the speech is finished and you want the normal element loop.',
          target: '[data-tour="keymap-hint"]',
        }]
      : []),
    {
      title: `${modeLabel} elements`,
      body: 'Press Tab to cycle forward through element types, or Shift+Tab to move backward.',
      showElements: true,
    },
  ];
}

function getTooltipPosition(rect: DOMRect): React.CSSProperties {
  const width = Math.min(390, window.innerWidth - 32);
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - width / 2, 16),
    window.innerWidth - width - 16
  );
  const top = rect.top > 320
    ? Math.max(16, rect.top - 16)
    : Math.min(window.innerHeight - 16, rect.bottom + 16);

  return {
    left,
    top,
    width,
    transform: rect.top > 320 ? 'translateY(-100%)' : 'none',
  };
}

export function ProductTour({ documentMode, onClose }: ProductTourProps) {
  const steps = useMemo(() => getSteps(documentMode), [documentMode]);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const step = steps[stepIndex];

  useEffect(() => {
    const updateTarget = () => {
      const target = step.target ? document.querySelector(step.target) : null;
      setTargetRect(target?.getBoundingClientRect() ?? null);
    };

    updateTarget();
    window.addEventListener('resize', updateTarget);

    return () => {
      window.removeEventListener('resize', updateTarget);
    };
  }, [step.target]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [stepIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const buttons = Array.from(
          cardRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
        );
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);

        if (
          buttons.length > 0 &&
          ((event.shiftKey && currentIndex <= 0) ||
            (!event.shiftKey && currentIndex === buttons.length - 1))
        ) {
          event.preventDefault();
          buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight' && stepIndex < steps.length - 1) {
        event.preventDefault();
        setStepIndex((current) => current + 1);
      } else if (event.key === 'ArrowLeft' && stepIndex > 0) {
        event.preventDefault();
        setStepIndex((current) => current - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, stepIndex, steps.length]);

  const isLastStep = stepIndex === steps.length - 1;

  return (
    <div className={`product-tour${targetRect ? ' has-target' : ''}`}>
      {targetRect && (
        <div
          className="product-tour-highlight"
          style={{
            left: targetRect.left - 8,
            top: targetRect.top - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
          }}
        />
      )}

      <section
        ref={cardRef}
        className={`product-tour-card${step.showElements ? ' is-elements-step' : ''}`}
        style={targetRect ? getTooltipPosition(targetRect) : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-tour-title"
        aria-describedby="product-tour-description"
      >
        <div className="product-tour-card-top">
          <span>{MODE_LABELS[documentMode]} tour</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="product-tour-close"
            onClick={onClose}
            aria-label="Close tour"
          >
            ×
          </button>
        </div>

        <div className="product-tour-progress" aria-hidden="true">
          {steps.map((_, index) => (
            <span key={index} className={index === stepIndex ? 'is-active' : ''} />
          ))}
        </div>

        <h2 id="product-tour-title">{step.title}</h2>
        <p id="product-tour-description">{step.body}</p>

        {step.showElements && (
          <div className="product-tour-elements">
            {MODE_ELEMENT_TYPES[documentMode].map((elementType) => (
              <div key={elementType} className="product-tour-element">
                <span>{ELEMENT_LABELS[elementType]}</span>
                <small>{ELEMENT_DESCRIPTIONS[elementType]}</small>
              </div>
            ))}
          </div>
        )}

        <div className="product-tour-actions">
          <span>{stepIndex + 1} of {steps.length}</span>
          <div>
            {stepIndex > 0 && (
              <button type="button" className="product-tour-secondary" onClick={() => setStepIndex(stepIndex - 1)}>
                Back
              </button>
            )}
            <button
              type="button"
              className="product-tour-primary"
              onClick={() => {
                if (isLastStep) {
                  onClose();
                } else {
                  setStepIndex(stepIndex + 1);
                }
              }}
            >
              {isLastStep ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
