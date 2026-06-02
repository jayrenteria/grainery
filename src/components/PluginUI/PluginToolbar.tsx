import { useEffect, useRef } from 'react';
import { PluginIcon } from '../../plugins/ui/icons';
import type { EvaluatedUIControl, UIControlMount } from '../../plugins';

interface PluginToolbarProps {
  mount: UIControlMount;
  controls: EvaluatedUIControl[];
  onTrigger: (controlId: string) => void;
}

export function PluginToolbar({ mount, controls, onTrigger }: PluginToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mount !== 'bottom-bar') {
      return;
    }

    const root = document.documentElement;
    const clearInsets = () => {
      root.style.removeProperty('--plugin-bottom-left-inset');
      root.style.removeProperty('--plugin-bottom-right-inset');
    };

    const updateInsets = () => {
      const toolbar = toolbarRef.current;
      if (!toolbar || controls.length === 0) {
        clearInsets();
        return;
      }

      const rect = toolbar.getBoundingClientRect();
      const gap = 12;
      const isRightCorner = rect.left > window.innerWidth / 2;

      if (isRightCorner) {
        root.style.removeProperty('--plugin-bottom-left-inset');
        root.style.setProperty(
          '--plugin-bottom-right-inset',
          `${Math.ceil(window.innerWidth - rect.left + gap)}px`
        );
      } else {
        root.style.setProperty('--plugin-bottom-left-inset', `${Math.ceil(rect.right + gap)}px`);
        root.style.removeProperty('--plugin-bottom-right-inset');
      }
    };

    updateInsets();

    const resizeObserver = new ResizeObserver(updateInsets);
    if (toolbarRef.current) {
      resizeObserver.observe(toolbarRef.current);
    }
    window.addEventListener('resize', updateInsets);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateInsets);
      clearInsets();
    };
  }, [mount, controls.length]);

  if (controls.length === 0) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className={`plugin-toolbar plugin-toolbar-${mount}`}
      role="toolbar"
      aria-label={`Plugin ${mount.replace('-', ' ')} toolbar`}
    >
      {controls.map((control) => (
        <button
          key={control.id}
          type="button"
          className={`plugin-toolbar-button ${control.state.active ? 'is-active' : ''}`}
          disabled={control.state.disabled}
          title={control.tooltip || control.label}
          aria-pressed={control.state.active}
          onClick={() => onTrigger(control.id)}
        >
          <PluginIcon icon={control.icon} className="h-4 w-4" />
          {control.kind !== 'button' && <span className="plugin-toolbar-label">{control.label}</span>}
          {control.state.text ? <span className="plugin-toolbar-meta">{control.state.text}</span> : null}
        </button>
      ))}
    </div>
  );
}
