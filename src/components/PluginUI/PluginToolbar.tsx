import { PluginIcon } from '../../plugins/ui/icons';
import type { EvaluatedUIControl } from '../../plugins';

interface PluginToolbarProps {
  mount: 'top-bar' | 'bottom-bar';
  controls: EvaluatedUIControl[];
  onTrigger: (controlId: string) => void;
}

export function PluginToolbar({ mount, controls, onTrigger }: PluginToolbarProps) {
  if (controls.length === 0) {
    return null;
  }

  return (
    <div
      className={`plugin-toolbar ${mount === 'top-bar' ? 'plugin-toolbar-top' : 'plugin-toolbar-bottom'}`}
      role="toolbar"
      aria-label={mount === 'top-bar' ? 'Plugin top toolbar' : 'Plugin bottom toolbar'}
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
