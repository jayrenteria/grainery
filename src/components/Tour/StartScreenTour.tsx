import { useEffect, useRef, useState } from 'react';

interface StartScreenTourProps {
  onClose: () => void;
}

export function StartScreenTour({ onClose }: StartScreenTourProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const updateTarget = () => {
      const target = document.querySelector('[data-tour="start-settings"]');
      setTargetRect(target?.getBoundingClientRect() ?? null);
    };

    updateTarget();
    closeButtonRef.current?.focus();
    window.addEventListener('resize', updateTarget);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

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
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('resize', updateTarget);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  const cardStyle: React.CSSProperties | undefined = targetRect
    ? {
        left: 'auto',
        right: Math.max(16, window.innerWidth - targetRect.right),
        top: targetRect.bottom + 16,
        width: Math.min(390, window.innerWidth - 32),
        transform: 'none',
      }
    : undefined;

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
        className="product-tour-card start-screen-tour-card"
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-screen-tour-title"
        aria-describedby="start-screen-tour-description"
      >
        <div className="product-tour-card-top">
          <span>Start screen tour</span>
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

        <h2 id="start-screen-tour-title">Make Grainery yours</h2>
        <p id="start-screen-tour-description">
          Open Settings to change themes, keyboard hints, autosave, Smart Loop behavior,
          plugins, and to replay editor tours.
        </p>

        <div className="product-tour-actions">
          <span aria-hidden="true" />
          <button type="button" className="product-tour-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}
