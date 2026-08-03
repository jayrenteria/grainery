import type {
  EditorCompletionItem,
  EditorLandmark,
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
export const MAX_COMPLETIONS_PER_PROVIDER = 12;
export const MAX_LANDMARKS_PER_PROVIDER = 1_000;
export const MAX_PANEL_NESTING_DEPTH = 8;

const LOCAL_ID_RE = /^[a-zA-Z0-9._-]+$/;
const UI_CONTROL_MOUNTS = new Set(['top-bar', 'bottom-bar', 'editor-floating']);
const UI_CONTROL_KINDS = new Set(['button', 'toggle', 'segmented']);
const BUILTIN_ICONS = new Set([
  'scene-heading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'comic-page',
  'comic-panel',
  'caption',
  'sound-effect',
  'chevron-left',
  'chevron-right',
  'panel',
  'close',
  'settings',
  'spark',
  'command',
  'keyboard',
  'template',
  'title-page',
  'export',
  'diagnostics',
  'warning',
  'check',
  'info',
]);

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
  if (!UI_CONTROL_MOUNTS.has(control.mount)) {
    throw new Error(`UI control '${control.id}' has unsupported mount '${String(control.mount)}'`);
  }
  if (!UI_CONTROL_KINDS.has(control.kind)) {
    throw new Error(`UI control '${control.id}' has unsupported kind '${String(control.kind)}'`);
  }
  if (!BUILTIN_ICONS.has(control.icon)) {
    throw new Error(`UI control '${control.id}' has unsupported icon '${String(control.icon)}'`);
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
  if (panel.icon !== undefined && !BUILTIN_ICONS.has(panel.icon)) {
    throw new Error(`UI panel '${panel.id}' has unsupported icon '${String(panel.icon)}'`);
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

  const counter = { value: 0 };
  for (const block of content.blocks) {
    validatePanelBlock(block, scope, 0, counter);
  }
}

function validatePanelBlock(
  block: UIPanelBlock,
  scope: string,
  depth: number,
  counter: { value: number }
): void {
  if (depth > MAX_PANEL_NESTING_DEPTH) {
    throw new Error(`${scope} exceeds max nesting depth (${MAX_PANEL_NESTING_DEPTH})`);
  }

  counter.value += 1;
  if (counter.value > MAX_PANEL_BLOCKS) {
    throw new Error(`${scope} exceeds max total block count (${MAX_PANEL_BLOCKS})`);
  }

  if (!block || typeof block !== 'object') {
    throw new Error(`${scope} contains an invalid panel block`);
  }

  if (block.type === 'heading' || block.type === 'text') {
    if (typeof block.text !== 'string') {
      throw new Error(`${scope} ${block.type} block must include text`);
    }
  }

  if (block.type === 'callout') {
    if (typeof block.text !== 'string') {
      throw new Error(`${scope} callout block must include text`);
    }
  }

  if (block.type === 'badgeList') {
    if (!Array.isArray(block.items)) {
      throw new Error(`${scope} badgeList block must include items[]`);
    }
  }

  if (block.type === 'progress') {
    if (typeof block.label !== 'string' || block.label.trim().length === 0) {
      throw new Error(`${scope} progress block must include label`);
    }
    if (!Number.isFinite(block.value)) {
      throw new Error(`${scope} progress block must include numeric value`);
    }
  }

  if (block.type === 'scroll') {
    if (!Array.isArray(block.blocks)) {
      throw new Error(`${scope} scroll block must include blocks[]`);
    }
    if (block.scrollToActionId !== undefined) {
      assertValidLocalId(block.scrollToActionId, `${scope} scroll target`);
    }
    for (const child of block.blocks) {
      validatePanelBlock(child, scope, depth + 1, counter);
    }
  }

  if (block.type === 'actions') {
    if (!Array.isArray(block.actions)) {
      throw new Error(`${scope} actions block must include actions[]`);
    }

    if (block.actions.length > MAX_ACTIONS_PER_BLOCK) {
      throw new Error(`${scope} actions block exceeds max actions (${MAX_ACTIONS_PER_BLOCK})`);
    }

    if (block.layout !== undefined && block.layout !== 'wrap' && block.layout !== 'stack') {
      throw new Error(`${scope} actions block has unsupported layout '${String(block.layout)}'`);
    }

    for (const action of block.actions) {
      assertValidLocalId(action.id, `${scope} action`);
      if (typeof action.label !== 'string' || action.label.trim().length === 0) {
        throw new Error(`${scope} action '${action.id}' must have a label`);
      }
      if (action.fullWidth !== undefined && typeof action.fullWidth !== 'boolean') {
        throw new Error(`${scope} action '${action.id}' fullWidth must be boolean`);
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

export function normalizeEditorCompletionsWithLimit(
  items: EditorCompletionItem[],
  limit = MAX_COMPLETIONS_PER_PROVIDER
): EditorCompletionItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const normalized: EditorCompletionItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') {
      continue;
    }

    const id = item.id.trim();
    const label = typeof item.label === 'string' ? item.label.replace(/\u0000/g, '').trim() : '';
    const insertText =
      typeof item.insertText === 'string' ? item.insertText.replace(/\u0000/g, '') : '';
    if (!isValidLocalId(id) || !label || !insertText || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      id,
      label: label.slice(0, 200),
      insertText: insertText.slice(0, 200),
      detail:
        typeof item.detail === 'string'
          ? item.detail.replace(/\u0000/g, '').trim().slice(0, 200) || undefined
          : undefined,
    });

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

export function normalizeEditorLandmarksWithLimit(
  items: EditorLandmark[],
  maxPosition: number,
  limit = MAX_LANDMARKS_PER_PROVIDER
): EditorLandmark[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const normalized: EditorLandmark[] = [];
  const seen = new Set<string>();
  const safeMax = Math.max(1, Math.floor(maxPosition));

  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') {
      continue;
    }

    const id = item.id.trim();
    const rawPosition = Number(item.position);
    const label = typeof item.label === 'string' ? item.label.replace(/\u0000/g, '').trim() : '';
    if (!isValidLocalId(id) || !Number.isFinite(rawPosition) || !label || seen.has(id)) {
      continue;
    }

    const position = Math.min(Math.max(Math.floor(rawPosition), 1), safeMax);
    const rawFrom = Number(item.from);
    const rawTo = Number(item.to);
    const from = Number.isFinite(rawFrom)
      ? Math.min(Math.max(Math.floor(rawFrom), 0), safeMax)
      : undefined;
    const to = Number.isFinite(rawTo)
      ? Math.min(Math.max(Math.floor(rawTo), 0), safeMax)
      : undefined;

    seen.add(id);
    normalized.push({
      id,
      position,
      ...(from !== undefined && to !== undefined && to > from ? { from, to } : {}),
      label: label.slice(0, 300),
      shortLabel:
        typeof item.shortLabel === 'string'
          ? item.shortLabel.replace(/\u0000/g, '').trim().slice(0, 32) || undefined
          : undefined,
      gutterLabel:
        typeof item.gutterLabel === 'string'
          ? item.gutterLabel.replace(/\u0000/g, '').trim().slice(0, 16) || undefined
          : undefined,
      active: Boolean(item.active),
    });

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}
