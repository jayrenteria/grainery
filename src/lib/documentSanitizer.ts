import {
  normalizeFontFamily,
  normalizeFontStyle,
  normalizeFontWeight,
  normalizeTextAlignment,
  normalizeTextSize,
} from './textStyles';

type Counter = Record<string, number>;
type DocumentMode = 'screenplay' | 'comic' | 'freewrite';
type CharacterExtension = 'V.O.' | 'O.S.' | "CONT'D" | 'O.C.' | null;

interface SanitizableMark {
  type?: string;
  attrs?: Record<string, unknown>;
}

interface SanitizableContent {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: SanitizableContent[];
  marks?: SanitizableMark[];
  text?: string;
}

interface SanitizedMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface SanitizedContent {
  type: string;
  attrs?: Record<string, unknown>;
  content?: SanitizedContent[];
  marks?: SanitizedMark[];
  text?: string;
}

export interface DocumentSanitizationReport {
  changed: boolean;
  repairedDocument: boolean;
  removedAttributeCount: number;
  removedMarkCount: number;
  removedNodeCount: number;
  removedAttributes: Counter;
  removedMarks: Counter;
  removedNodes: Counter;
}

export interface DocumentSanitizationResult {
  document: SanitizedContent;
  report: DocumentSanitizationReport;
}

const CHARACTER_EXTENSIONS: CharacterExtension[] = [null, 'V.O.', 'O.S.', "CONT'D", 'O.C.'];
const SCREENPLAY_ELEMENT_TYPES = [
  'sceneHeading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
];
const COMIC_ELEMENT_TYPES = [
  'comicPage',
  'comicPanel',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'caption',
  'soundEffect',
];
const FREEWRITE_ELEMENT_TYPES = ['title', 'heading', 'body', 'bulletItem', 'numberedItem'];
const DEFAULT_BLOCK_TYPE_BY_MODE: Record<DocumentMode, string> = {
  screenplay: 'sceneHeading',
  comic: 'comicPage',
  freewrite: 'title',
};

const SCREENPLAY_BLOCK_TYPES = new Set([
  ...SCREENPLAY_ELEMENT_TYPES,
  'comicPage',
  'comicPanel',
  'caption',
  'soundEffect',
  'pageBreak',
]);
const COMIC_BLOCK_TYPES = new Set([
  ...COMIC_ELEMENT_TYPES,
  'sceneHeading',
  'transition',
  'pageBreak',
]);
const FREEWRITE_BLOCK_TYPES = new Set(FREEWRITE_ELEMENT_TYPES);
const BLOCK_TYPES_BY_MODE: Record<DocumentMode, Set<string>> = {
  screenplay: SCREENPLAY_BLOCK_TYPES,
  comic: COMIC_BLOCK_TYPES,
  freewrite: FREEWRITE_BLOCK_TYPES,
};

const BLOCK_NODE_TYPES = new Set([
  ...SCREENPLAY_BLOCK_TYPES,
  ...COMIC_BLOCK_TYPES,
  ...FREEWRITE_BLOCK_TYPES,
]);
const INLINE_STYLE_MARKS = ['bold', 'italic', 'underline', 'fontFamily', 'textSize'] as const;
const RICH_TEXT_MARKS = new Set([...INLINE_STYLE_MARKS, 'strike']);
const SCREENPLAY_TEXT_MARKS = new Set(INLINE_STYLE_MARKS);
const PLAIN_TEXT_MARKS = new Set<string>();
const STRIKE_TEXT_NODES = new Set(['title', 'heading', 'body', 'bulletItem', 'numberedItem']);
const PLAIN_TEXT_NODES = new Set([
  'sceneHeading',
  'character',
  'parenthetical',
  'transition',
  'comicPage',
  'comicPanel',
]);

function createReport(): DocumentSanitizationReport {
  return {
    changed: false,
    repairedDocument: false,
    removedAttributeCount: 0,
    removedMarkCount: 0,
    removedNodeCount: 0,
    removedAttributes: {},
    removedMarks: {},
    removedNodes: {},
  };
}

function increment(counter: Counter, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function removeAttribute(report: DocumentSanitizationReport, name: string): void {
  report.changed = true;
  report.removedAttributeCount += 1;
  increment(report.removedAttributes, name);
}

function removeMark(report: DocumentSanitizationReport, type: string): void {
  report.changed = true;
  report.removedMarkCount += 1;
  increment(report.removedMarks, type);
}

function removeNode(report: DocumentSanitizationReport, type: string): void {
  report.changed = true;
  report.removedNodeCount += 1;
  increment(report.removedNodes, type);
}

function repairDocument(report: DocumentSanitizationReport): void {
  report.changed = true;
  report.repairedDocument = true;
}

function allowedMarksForNode(type: string | null): Set<string> {
  if (!type || PLAIN_TEXT_NODES.has(type)) {
    return PLAIN_TEXT_MARKS;
  }

  return STRIKE_TEXT_NODES.has(type) ? RICH_TEXT_MARKS : SCREENPLAY_TEXT_MARKS;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function markKey(mark: SanitizedMark): string {
  return JSON.stringify({
    type: mark.type,
    attrs: mark.attrs ?? null,
  });
}

function sanitizeMark(
  mark: SanitizableMark,
  allowedMarks: Set<string>,
  report: DocumentSanitizationReport
): SanitizedMark | null {
  const type = mark.type;
  if (!type || !allowedMarks.has(type)) {
    removeMark(report, type ?? 'unknown');
    return null;
  }

  if (type === 'fontFamily') {
    const fontFamily = normalizeFontFamily(mark.attrs?.fontFamily);
    if (!fontFamily) {
      removeMark(report, type);
      return null;
    }

    const fontWeight = normalizeFontWeight(mark.attrs?.fontWeight);
    const fontStyle = normalizeFontStyle(mark.attrs?.fontStyle);
    return {
      type,
      attrs: {
        fontFamily,
        fontWeight,
        fontStyle,
      },
    };
  }

  if (type === 'textSize') {
    const sizePt = normalizeTextSize(mark.attrs?.sizePt);
    if (sizePt === null) {
      removeMark(report, type);
      return null;
    }

    return {
      type,
      attrs: {
        sizePt,
      },
    };
  }

  return { type };
}

function sanitizeMarks(
  marks: SanitizableContent['marks'],
  parentType: string | null,
  report: DocumentSanitizationReport
): SanitizedContent['marks'] {
  if (!Array.isArray(marks) || marks.length === 0) {
    return undefined;
  }

  const allowedMarks = allowedMarksForNode(parentType);
  const sanitized: SanitizedMark[] = [];
  const seen = new Set<string>();

  for (const mark of marks) {
    const nextMark = sanitizeMark(mark, allowedMarks, report);
    if (!nextMark) {
      continue;
    }

    const key = markKey(nextMark);
    if (seen.has(key)) {
      removeMark(report, nextMark.type ?? 'unknown');
      continue;
    }

    seen.add(key);
    sanitized.push(nextMark);
  }

  return sanitized.length > 0 ? sanitized : undefined;
}

function copyTextAlignAttr(
  attrs: Record<string, unknown>,
  nextAttrs: Record<string, unknown>,
  report: DocumentSanitizationReport
): void {
  if (!Object.prototype.hasOwnProperty.call(attrs, 'textAlign')) {
    return;
  }

  const rawTextAlign = attrs.textAlign;
  if (rawTextAlign === null || rawTextAlign === undefined) {
    return;
  }

  const textAlign = normalizeTextAlignment(rawTextAlign);
  if (textAlign) {
    nextAttrs.textAlign = textAlign;
    return;
  }

  removeAttribute(report, 'textAlign');
}

function sanitizeNodeAttrs(
  type: string,
  attrs: unknown,
  report: DocumentSanitizationReport
): Record<string, unknown> | undefined {
  if (!isObject(attrs)) {
    return undefined;
  }

  const nextAttrs: Record<string, unknown> = {};
  const allowedAttrs = new Set<string>();

  if (BLOCK_NODE_TYPES.has(type) && type !== 'pageBreak') {
    allowedAttrs.add('textAlign');
    copyTextAlignAttr(attrs, nextAttrs, report);
  }

  if (type === 'character') {
    allowedAttrs.add('extension');
    const extension = attrs.extension;
    if (extension === null || CHARACTER_EXTENSIONS.includes(extension as CharacterExtension)) {
      if (extension) {
        nextAttrs.extension = extension;
      }
    } else if (Object.prototype.hasOwnProperty.call(attrs, 'extension')) {
      removeAttribute(report, 'extension');
    }
  }

  if (type === 'sceneHeading') {
    allowedAttrs.add('sceneNumber');
    const sceneNumber = attrs.sceneNumber;
    if (typeof sceneNumber === 'string' || typeof sceneNumber === 'number') {
      nextAttrs.sceneNumber = sceneNumber;
    } else if (sceneNumber !== null && sceneNumber !== undefined) {
      removeAttribute(report, 'sceneNumber');
    }
  }

  for (const key of Object.keys(attrs)) {
    if (!allowedAttrs.has(key)) {
      removeAttribute(report, key);
    }
  }

  return Object.keys(nextAttrs).length > 0 ? nextAttrs : undefined;
}

function textFromUnknownNode(node: SanitizableContent): string {
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text;
  }

  if (!Array.isArray(node.content)) {
    return '';
  }

  return node.content.map(textFromUnknownNode).join('');
}

function sanitizeTextNode(
  node: SanitizableContent,
  parentType: string | null,
  report: DocumentSanitizationReport
): SanitizedContent | null {
  if (typeof node.text !== 'string' || node.text.length === 0) {
    repairDocument(report);
    return null;
  }

  const marks = sanitizeMarks(node.marks, parentType, report);
  return {
    type: 'text',
    ...(marks ? { marks } : {}),
    text: node.text,
  };
}

function sanitizeInlineContent(
  content: SanitizableContent['content'],
  parentType: string,
  report: DocumentSanitizationReport
): SanitizedContent['content'] {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const nextContent: SanitizedContent[] = [];
  for (const child of content) {
    if (child.type === 'text') {
      const textNode = sanitizeTextNode(child, parentType, report);
      if (textNode) {
        nextContent.push(textNode);
      }
      continue;
    }

    const text = textFromUnknownNode(child);
    removeNode(report, child.type ?? 'unknown');
    if (text) {
      nextContent.push({ type: 'text', text });
    }
  }

  return nextContent.length > 0 ? nextContent : undefined;
}

function fallbackBlockType(documentMode: DocumentMode): string {
  if (documentMode === 'freewrite') {
    return 'body';
  }

  return 'action';
}

function plainTextBlock(text: string, documentMode: DocumentMode): SanitizedContent {
  return {
    type: fallbackBlockType(documentMode),
    content: text ? [{ type: 'text', text }] : [],
  };
}

function defaultDocument(documentMode: DocumentMode): SanitizedContent {
  return {
    type: 'doc',
    content: [
      {
        type: DEFAULT_BLOCK_TYPE_BY_MODE[documentMode],
        content: [],
      },
    ],
  };
}

function sanitizeBlockNode(
  node: SanitizableContent,
  documentMode: DocumentMode,
  report: DocumentSanitizationReport
): SanitizedContent | null {
  const type = node.type;
  if (!type || !BLOCK_TYPES_BY_MODE[documentMode].has(type)) {
    const text = textFromUnknownNode(node);
    removeNode(report, type ?? 'unknown');
    return text ? plainTextBlock(text, documentMode) : null;
  }

  if (type === 'pageBreak') {
    return { type };
  }

  const attrs = sanitizeNodeAttrs(type, node.attrs, report);
  const content = sanitizeInlineContent(node.content, type, report);

  return {
    type,
    ...(attrs ? { attrs } : {}),
    ...(content ? { content } : {}),
  };
}

function sanitizeDocContent(
  content: SanitizableContent['content'],
  documentMode: DocumentMode,
  report: DocumentSanitizationReport
): SanitizedContent['content'] {
  if (!Array.isArray(content)) {
    repairDocument(report);
    return defaultDocument(documentMode).content;
  }

  const nextContent: SanitizedContent[] = [];
  for (const child of content) {
    const block = sanitizeBlockNode(child, documentMode, report);
    if (block) {
      nextContent.push(block);
    }
  }

  if (nextContent.length === 0) {
    repairDocument(report);
    return defaultDocument(documentMode).content;
  }

  return nextContent;
}

export function sanitizeEditorDocument(
  document: unknown,
  documentMode: DocumentMode
): DocumentSanitizationResult {
  const report = createReport();
  if (!isObject(document) || document.type !== 'doc') {
    repairDocument(report);
    return {
      document: defaultDocument(documentMode),
      report,
    };
  }

  return {
    document: {
      type: 'doc',
      content: sanitizeDocContent((document as SanitizableContent).content, documentMode, report),
    },
    report,
  };
}

function countSummary(count: number, singular: string): string | null {
  if (count === 0) {
    return null;
  }

  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function counterNames(counter: Counter): string {
  return Object.keys(counter).sort().join(', ');
}

export function getDocumentSanitizationWarning(report: DocumentSanitizationReport): string | null {
  if (!report.changed) {
    return null;
  }

  const counts = [
    countSummary(report.removedNodeCount, 'unsupported block'),
    countSummary(report.removedMarkCount, 'unsupported style'),
    countSummary(report.removedAttributeCount, 'unsupported attribute'),
  ].filter(Boolean);

  const details = [
    report.removedNodeCount > 0 ? `Blocks: ${counterNames(report.removedNodes)}` : null,
    report.removedMarkCount > 0 ? `Styles: ${counterNames(report.removedMarks)}` : null,
    report.removedAttributeCount > 0 ? `Attributes: ${counterNames(report.removedAttributes)}` : null,
  ].filter(Boolean);

  return [
    'This file contains document data from a newer or incompatible version of Grainery.',
    `Grainery opened the readable text and removed ${counts.join(', ') || 'unsupported data'}.`,
    'If you save this file, the unsupported data will not be preserved.',
    details.length > 0 ? `Removed: ${details.join('; ')}.` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}
