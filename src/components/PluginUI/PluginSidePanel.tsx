import type { CSSProperties } from 'react';
import { PluginIcon } from '../../plugins/ui/icons';
import type { EvaluatedUIPanel, UIPanelActionItem, UIPanelBlock } from '../../plugins';

interface PluginSidePanelProps {
  panel: EvaluatedUIPanel | null;
  formValues: Record<string, string>;
  onClose: () => void;
  onAction: (panelId: string, actionId: string) => void;
  onFormValueChange: (panelId: string, fieldId: string, value: string) => void;
}

const DEFAULT_INPUT_MAX_LENGTH = 200;
const DEFAULT_TEXTAREA_MAX_LENGTH = 4000;

function sanitizeInputValue(value: string, maxLength: number): string {
  const normalized = value.replace(/\u0000/g, '');
  return normalized.slice(0, maxLength);
}

function quotedFontFamily(value: string): string {
  const family = value
    .replace(/[\u0000\r\n\f]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .trim()
    .slice(0, 128);
  return family ? `"${family}", ui-sans-serif, system-ui, sans-serif` : 'inherit';
}

function actionPreviewStyle(action: UIPanelActionItem): CSSProperties | undefined {
  const preview = action.preview;
  if (!preview) {
    return undefined;
  }

  const style: CSSProperties = {};
  if (typeof preview.fontFamily === 'string') {
    style.fontFamily = quotedFontFamily(preview.fontFamily);
  }
  if (typeof preview.fontWeight === 'number' && Number.isFinite(preview.fontWeight)) {
    style.fontWeight = Math.min(1000, Math.max(1, Math.round(preview.fontWeight)));
  }
  if (preview.fontStyle === 'normal' || preview.fontStyle === 'italic' || preview.fontStyle === 'oblique') {
    style.fontStyle = preview.fontStyle;
  }

  if (Object.keys(style).length === 0) {
    return undefined;
  }

  style.fontSize = '0.95rem';
  style.lineHeight = 1.1;
  return style;
}

function renderBlock(
  panelId: string,
  block: UIPanelBlock,
  index: number,
  formValues: Record<string, string>,
  onAction: (panelId: string, actionId: string) => void,
  onFormValueChange: (panelId: string, fieldId: string, value: string) => void
) {
  const isSceneOutlinePanel =
    panelId.endsWith(':scene-outline-panel') || panelId === 'scene-outline-panel';

  switch (block.type) {
    case 'heading': {
      const HeadingTag = block.level === 4 ? 'h4' : block.level === 3 ? 'h3' : 'h2';
      return (
        <HeadingTag key={`${panelId}-heading-${index}`} className="plugin-panel-heading">
          {block.text}
        </HeadingTag>
      );
    }
    case 'text':
      return (
        <p key={`${panelId}-text-${index}`} className="plugin-panel-text">
          {block.text}
        </p>
      );
    case 'divider':
      return <hr key={`${panelId}-divider-${index}`} className="plugin-panel-divider" />;
    case 'scroll': {
      const maxHeight =
        typeof block.maxHeight === 'number' && Number.isFinite(block.maxHeight)
          ? Math.min(520, Math.max(80, Math.floor(block.maxHeight)))
          : 260;

      return (
        <div
          key={`${panelId}-scroll-${index}`}
          className="plugin-panel-scroll"
          style={{ maxHeight }}
        >
          {block.blocks.map((child, childIndex) =>
            renderBlock(
              panelId,
              child,
              childIndex,
              formValues,
              onAction,
              onFormValueChange
            )
          )}
        </div>
      );
    }
    case 'callout':
      return (
        <div
          key={`${panelId}-callout-${index}`}
          className={`plugin-panel-callout plugin-panel-callout-${block.tone ?? 'info'}`}
        >
          {block.title ? <div className="plugin-panel-callout-title">{block.title}</div> : null}
          <div>{block.text}</div>
        </div>
      );
    case 'badgeList':
      return (
        <div key={`${panelId}-badges-${index}`} className="plugin-panel-badges">
          {block.items.map((item, itemIndex) => (
            <span
              key={`${panelId}-badge-${itemIndex}`}
              className={`plugin-panel-badge plugin-panel-badge-${item.tone ?? 'neutral'}`}
            >
              <span>{item.label}</span>
              {item.value ? <strong>{item.value}</strong> : null}
            </span>
          ))}
        </div>
      );
    case 'progress': {
      const max = typeof block.max === 'number' && Number.isFinite(block.max) && block.max > 0
        ? block.max
        : 100;
      const value = Number.isFinite(block.value) ? Math.min(max, Math.max(0, block.value)) : 0;
      const percent = Math.round((value / max) * 100);

      return (
        <div key={`${panelId}-progress-${index}`} className="plugin-panel-progress">
          <div className="plugin-panel-progress-label">
            <span>{block.label}</span>
            <span>{percent}%</span>
          </div>
          <progress
            className={`progress plugin-panel-progress-bar plugin-panel-progress-${block.tone ?? 'neutral'}`}
            value={value}
            max={max}
          />
        </div>
      );
    }
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
          {block.actions.map((action) => {
            const previewStyle = actionPreviewStyle(action);

            return (
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
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => onAction(panelId, action.id)}
                style={previewStyle}
              >
                <span className="plugin-panel-action-label" style={previewStyle}>
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
      );
    case 'input': {
      const maxLength =
        typeof block.maxLength === 'number' && Number.isFinite(block.maxLength)
          ? Math.max(1, Math.floor(block.maxLength))
          : DEFAULT_INPUT_MAX_LENGTH;
      const currentValue =
        typeof formValues[block.fieldId] === 'string'
          ? formValues[block.fieldId]
          : (block.value ?? '');

      return (
        <label key={`${panelId}-input-${index}`} className="plugin-panel-field">
          {block.label ? <span className="plugin-panel-field-label">{block.label}</span> : null}
          <input
            type="text"
            className="input input-xs plugin-panel-input"
            value={currentValue}
            maxLength={maxLength}
            placeholder={block.placeholder ?? ''}
            onChange={(event) =>
              onFormValueChange(
                panelId,
                block.fieldId,
                sanitizeInputValue(event.target.value, maxLength)
              )
            }
          />
        </label>
      );
    }
    case 'textarea': {
      const maxLength =
        typeof block.maxLength === 'number' && Number.isFinite(block.maxLength)
          ? Math.max(1, Math.floor(block.maxLength))
          : DEFAULT_TEXTAREA_MAX_LENGTH;
      const rows =
        typeof block.rows === 'number' && Number.isFinite(block.rows)
          ? Math.min(16, Math.max(2, Math.floor(block.rows)))
          : 4;
      const currentValue =
        typeof formValues[block.fieldId] === 'string'
          ? formValues[block.fieldId]
          : (block.value ?? '');

      return (
        <label key={`${panelId}-textarea-${index}`} className="plugin-panel-field">
          {block.label ? <span className="plugin-panel-field-label">{block.label}</span> : null}
          <textarea
            className="textarea textarea-xs plugin-panel-textarea"
            value={currentValue}
            rows={rows}
            maxLength={maxLength}
            placeholder={block.placeholder ?? ''}
            onChange={(event) =>
              onFormValueChange(
                panelId,
                block.fieldId,
                sanitizeInputValue(event.target.value, maxLength)
              )
            }
          />
        </label>
      );
    }
    default:
      return null;
  }
}

export function PluginSidePanel({
  panel,
  formValues,
  onClose,
  onAction,
  onFormValueChange,
}: PluginSidePanelProps) {
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
        {panel.content.blocks.map((block, index) =>
          renderBlock(
            panel.id,
            block,
            index,
            formValues,
            onAction,
            onFormValueChange
          )
        )}
      </div>
    </aside>
  );
}
