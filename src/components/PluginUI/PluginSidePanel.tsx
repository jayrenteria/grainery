import { PluginIcon } from '../../plugins/ui/icons';
import type { EvaluatedUIPanel, UIPanelBlock } from '../../plugins';

interface PluginSidePanelProps {
  panel: EvaluatedUIPanel | null;
  onClose: () => void;
  onAction: (panelId: string, actionId: string) => void;
}

function renderBlock(
  panelId: string,
  block: UIPanelBlock,
  index: number,
  onAction: (panelId: string, actionId: string) => void
) {
  const isSceneOutlinePanel =
    panelId.endsWith(':scene-outline-panel') || panelId === 'scene-outline-panel';

  switch (block.type) {
    case 'text':
      return (
        <p key={`${panelId}-text-${index}`} className="plugin-panel-text">
          {block.text}
        </p>
      );
    case 'list':
      return (
        <ul key={`${panelId}-list-${index}`} className="plugin-panel-list">
          {block.items.map((item, itemIndex) => (
            <li key={`${panelId}-list-item-${itemIndex}`}>{item}</li>
          ))}
        </ul>
      );
    case 'keyValue':
      return (
        <dl key={`${panelId}-kv-${index}`} className="plugin-panel-kv">
          {block.items.map((item, itemIndex) => (
            <div key={`${panelId}-kv-item-${itemIndex}`} className="plugin-panel-kv-row">
              <dt>{item.key}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'actions':
      return (
        <div key={`${panelId}-actions-${index}`} className="plugin-panel-actions">
          {block.actions.map((action) => (
            <button
              key={`${panelId}-action-${action.id}`}
              type="button"
              className={`btn btn-xs ${
                action.variant === 'primary'
                  ? 'btn-primary'
                  : action.variant === 'outline'
                    ? 'btn-outline'
                    : action.variant === 'ghost'
                      ? 'btn-ghost'
                      : 'btn-neutral'
              } ${isSceneOutlinePanel ? 'font-bold uppercase w-full justify-start' : ''}`}
              onClick={() => onAction(panelId, action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      );
    default:
      return null;
  }
}

export function PluginSidePanel({ panel, onClose, onAction }: PluginSidePanelProps) {
  if (!panel) {
    return null;
  }

  const width = panel.defaultWidth ?? 280;

  return (
    <aside className="plugin-side-panel" style={{ width }} aria-label={`${panel.title} panel`}>
      <header className="plugin-side-panel-header">
        <div className="plugin-side-panel-title-wrap">
          <PluginIcon icon={panel.icon ?? 'panel'} className="h-4 w-4" />
          <h3 className="plugin-side-panel-title">{panel.title}</h3>
        </div>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} title="Close panel">
          <PluginIcon icon="close" className="h-3 w-3" />
        </button>
      </header>
      <div className="plugin-side-panel-body">
        {panel.content.blocks.map((block, index) => renderBlock(panel.id, block, index, onAction))}
      </div>
    </aside>
  );
}
