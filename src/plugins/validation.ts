import type {
  InlineAnnotation,
  UIPanelBlock,
  UIPanelContent,
  UIControlAction,
  UIControlDefinition,
  UIPanelDefinition,
} from './types';

export const MAX_PANEL_BLOCKS = 256;
export const MAX_ACTIONS_PER_BLOCK = 64;
export const MAX_ANNOTATIONS_PER_PROVIDER = 500;

const LOCAL_ID_RE = /^[a-zA-Z0-9._-]+$/;

export function isValidLocalId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && LOCAL_ID_RE.test(value) && !value.includes(':');
}

export function assertValidLocalId(value: string, scope: string): void {
  if (!isValidLocalId(value)) {
    throw new Error(`${scope} id must match ^[a-zA-Z0-9._-]+$, be <=64 chars, and must not include ':'`);
  }
}

export function assertContributedId(
  localId: string,
  allowedIds: Set<string>,
  scope: string
): void {
  if (!allowedIds.has(localId)) {
    throw new Error(`${scope} '${localId}' is not declared in manifest.contributes`);
  }
}

export function validateUiControlDefinition(control: UIControlDefinition): void {
  assertValidLocalId(control.id, 'UI control');
  if (typeof control.label !== 'string' || control.label.trim().length === 0) {
    throw new Error(`UI control '${control.id}' label is required`);
  }
  if (control.when !== undefined && typeof control.when !== 'string') {
    throw new Error(`UI control '${control.id}' when must be a string when provided`);
  }
  if (control.action) {
    validateUiAction(control.action, `UI control '${control.id}'`);
  }
}

export function validateUiPanelDefinition(panel: UIPanelDefinition): void {
  assertValidLocalId(panel.id, 'UI panel');
  if (typeof panel.title !== 'string' || panel.title.trim().length === 0) {
    throw new Error(`UI panel '${panel.id}' title is required`);
  }
  if (panel.when !== undefined && typeof panel.when !== 'string') {
    throw new Error(`UI panel '${panel.id}' when must be a string when provided`);
  }
  if (panel.content) {
    validatePanelContent(panel.content, `UI panel '${panel.id}'`);
  }
}

export function validatePanelContent(content: UIPanelContent, scope: string): void {
  if (!content || !Array.isArray(content.blocks)) {
    throw new Error(`${scope} content must include blocks[]`);
  }

  if (content.blocks.length > MAX_PANEL_BLOCKS) {
    throw new Error(`${scope} exceeds max block count (${MAX_PANEL_BLOCKS})`);
  }

  for (const block of content.blocks) {
    validatePanelBlock(block, scope);
  }
}

function validatePanelBlock(block: UIPanelBlock, scope: string): void {
  if (!block || typeof block !== 'object') {
    throw new Error(`${scope} contains an invalid panel block`);
  }

  if (block.type === 'actions') {
    if (!Array.isArray(block.actions)) {
      throw new Error(`${scope} actions block must include actions[]`);
    }

    if (block.actions.length > MAX_ACTIONS_PER_BLOCK) {
      throw new Error(`${scope} actions block exceeds max actions (${MAX_ACTIONS_PER_BLOCK})`);
    }

    for (const action of block.actions) {
      assertValidLocalId(action.id, `${scope} action`);
      if (typeof action.label !== 'string' || action.label.trim().length === 0) {
        throw new Error(`${scope} action '${action.id}' must have a label`);
      }
    }
  }

  if (block.type === 'input' || block.type === 'textarea') {
    assertValidLocalId(block.fieldId, `${scope} field`);
  }
}

export function validateUiAction(action: UIControlAction, scope: string): void {
  if (!action || typeof action !== 'object') {
    throw new Error(`${scope} action is invalid`);
  }

  switch (action.type) {
    case 'command':
      if (typeof action.commandId !== 'string' || action.commandId.trim().length === 0) {
        throw new Error(`${scope} command action must include commandId`);
      }
      return;
    case 'panel:open':
    case 'panel:close':
    case 'panel:toggle':
      if (typeof action.panelId !== 'string' || action.panelId.trim().length === 0) {
        throw new Error(`${scope} panel action must include panelId`);
      }
      return;
    case 'editor:jump-to':
      if (!Number.isFinite(action.position)) {
        throw new Error(`${scope} jump action must include numeric position`);
      }
      return;
    case 'editor:set-element':
    case 'editor:cycle-element':
    case 'editor:escape-to-action':
      return;
    default:
      throw new Error(`${scope} has unsupported action type '${String((action as { type?: unknown }).type)}'`);
  }
}

export function normalizeInlineAnnotationsWithLimit(
  annotations: InlineAnnotation[],
  limit = MAX_ANNOTATIONS_PER_PROVIDER
): InlineAnnotation[] {
  if (!Array.isArray(annotations)) {
    return [];
  }

  const normalized: InlineAnnotation[] = [];

  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== 'object') {
      continue;
    }

    if (typeof annotation.id !== 'string' || annotation.id.trim().length === 0) {
      continue;
    }

    if (!Number.isFinite(Number(annotation.from)) || !Number.isFinite(Number(annotation.to))) {
      continue;
    }

    normalized.push(annotation);
    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}
