import type { JSONContent } from '@tiptap/react';
import type { ScreenplayDocument } from './types';
import {
  normalizeFontFamily,
  normalizeFontStyle,
  normalizeFontWeight,
  normalizeTextAlignment,
  normalizeTextSize,
  type TextAlignment,
} from './textStyles';

const SYSTEM_FONT_STYLES_PLUGIN_ID = 'com.grainery.system-font-styles';
const ARCHIVE_KEY = 'compatibilityTextStyles';
const ARCHIVE_SCHEMA_VERSION = 1;
const STYLE_MARK_TYPES = new Set(['fontFamily', 'textSize']);

type JsonMark = NonNullable<JSONContent['marks']>[number];

interface ArchivedTextStyle {
  path: number[];
  text: string;
  marks: JsonMark[];
}

interface ArchivedBlockStyle {
  path: number[];
  type: string | null;
  textAlign: TextAlignment;
}

interface TextStyleArchive {
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  contentHash: string;
  styles: ArchivedTextStyle[];
  blockStyles: ArchivedBlockStyle[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeStyleMark(mark: JsonMark): JsonMark | null {
  if (!mark || typeof mark.type !== 'string') {
    return null;
  }

  if (mark.type === 'fontFamily') {
    const fontFamily = normalizeFontFamily(mark.attrs?.fontFamily);
    if (!fontFamily) {
      return null;
    }

    return {
      type: 'fontFamily',
      attrs: {
        fontFamily,
        fontWeight: normalizeFontWeight(mark.attrs?.fontWeight),
        fontStyle: normalizeFontStyle(mark.attrs?.fontStyle),
      },
    };
  }

  if (mark.type === 'textSize') {
    const sizePt = normalizeTextSize(mark.attrs?.sizePt);
    if (sizePt === null) {
      return null;
    }

    return {
      type: 'textSize',
      attrs: { sizePt },
    };
  }

  return null;
}

function stripArchivedMarksFromNode(
  node: JSONContent,
  path: number[],
  styles: ArchivedTextStyle[],
  blockStyles: ArchivedBlockStyle[]
): JSONContent {
  const next: JSONContent = { ...node };
  const textAlign = normalizeTextAlignment(node.attrs?.textAlign);

  if (textAlign) {
    blockStyles.push({
      path,
      type: node.type ?? null,
      textAlign,
    });

    const attrs = { ...(node.attrs ?? {}) };
    delete attrs.textAlign;
    if (Object.keys(attrs).length > 0) {
      next.attrs = attrs;
    } else {
      delete next.attrs;
    }
  }

  if (typeof node.text === 'string') {
    const marks = Array.isArray(node.marks) ? node.marks : [];
    const archivedMarks = marks
      .map((mark) => normalizeStyleMark(mark))
      .filter((mark): mark is NonNullable<ReturnType<typeof normalizeStyleMark>> => mark !== null);

    if (archivedMarks.length > 0) {
      styles.push({
        path,
        text: node.text,
        marks: archivedMarks,
      });
    }

    const remainingMarks = marks.filter((mark) => !STYLE_MARK_TYPES.has(mark.type ?? ''));
    if (remainingMarks.length > 0) {
      next.marks = remainingMarks;
    } else {
      delete next.marks;
    }

    return next;
  }

  if (Array.isArray(node.content)) {
    next.content = node.content.map((child, index) =>
      stripArchivedMarksFromNode(child, [...path, index], styles, blockStyles)
    );
  }

  return next;
}

function textSignatureForNode(node: JSONContent, output: string[]): void {
  output.push('(', node.type ?? '');

  if (typeof node.text === 'string') {
    output.push(':', node.text);
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      textSignatureForNode(child, output);
    }
  }

  output.push(')');
}

function documentTextHash(document: JSONContent): string {
  const signature: string[] = [];
  textSignatureForNode(document, signature);
  const value = signature.join('');
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function pluginDataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function withArchivePluginData(
  pluginData: ScreenplayDocument['pluginData'],
  archive: TextStyleArchive | null
): ScreenplayDocument['pluginData'] {
  const nextPluginData = pluginDataObject(pluginData);
  const pluginEntry = pluginDataObject(nextPluginData[SYSTEM_FONT_STYLES_PLUGIN_ID]);

  if (archive) {
    pluginEntry[ARCHIVE_KEY] = archive;
    nextPluginData[SYSTEM_FONT_STYLES_PLUGIN_ID] = pluginEntry;
    return nextPluginData;
  }

  delete pluginEntry[ARCHIVE_KEY];
  if (Object.keys(pluginEntry).length > 0) {
    nextPluginData[SYSTEM_FONT_STYLES_PLUGIN_ID] = pluginEntry;
  } else {
    delete nextPluginData[SYSTEM_FONT_STYLES_PLUGIN_ID];
  }

  return nextPluginData;
}

function readArchive(pluginData: ScreenplayDocument['pluginData']): TextStyleArchive | null {
  const pluginEntry = pluginData?.[SYSTEM_FONT_STYLES_PLUGIN_ID];
  if (!pluginEntry || typeof pluginEntry !== 'object' || Array.isArray(pluginEntry)) {
    return null;
  }

  const archive = (pluginEntry as Record<string, unknown>)[ARCHIVE_KEY];
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)) {
    return null;
  }

  const candidate = archive as Partial<TextStyleArchive>;
  if (
    candidate.schemaVersion !== ARCHIVE_SCHEMA_VERSION ||
    typeof candidate.contentHash !== 'string' ||
    !Array.isArray(candidate.styles)
  ) {
    return null;
  }

  return {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    contentHash: candidate.contentHash,
    styles: candidate.styles.filter(isArchivedTextStyle),
    blockStyles: Array.isArray(candidate.blockStyles)
      ? candidate.blockStyles.filter(isArchivedBlockStyle)
      : [],
  };
}

function isArchivedTextStyle(value: unknown): value is ArchivedTextStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ArchivedTextStyle>;
  return (
    Array.isArray(candidate.path) &&
    candidate.path.every((item) => Number.isInteger(item) && item >= 0) &&
    typeof candidate.text === 'string' &&
    Array.isArray(candidate.marks)
  );
}

function isArchivedBlockStyle(value: unknown): value is ArchivedBlockStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ArchivedBlockStyle>;
  return (
    Array.isArray(candidate.path) &&
    candidate.path.every((item) => Number.isInteger(item) && item >= 0) &&
    (candidate.type === null || typeof candidate.type === 'string') &&
    normalizeTextAlignment(candidate.textAlign) !== null
  );
}

function nodeAtPath(document: JSONContent, path: number[]): JSONContent | null {
  let node: JSONContent | undefined = document;

  for (const index of path) {
    node = node?.content?.[index];
    if (!node) {
      return null;
    }
  }

  return node;
}

function mergeStyleMarks(existing: JSONContent['marks'] = [], archived: JsonMark[] = []) {
  const normalizedArchived = archived
    .map((mark) => normalizeStyleMark(mark))
    .filter((mark): mark is NonNullable<ReturnType<typeof normalizeStyleMark>> => mark !== null);

  if (normalizedArchived.length === 0) {
    return existing;
  }

  return [
    ...(existing ?? []).filter((mark) => !STYLE_MARK_TYPES.has(mark.type ?? '')),
    ...normalizedArchived,
  ];
}

export function prepareDocumentForCompatibilitySave(doc: ScreenplayDocument): {
  appDocument: ScreenplayDocument;
  diskDocument: ScreenplayDocument;
} {
  const styles: ArchivedTextStyle[] = [];
  const blockStyles: ArchivedBlockStyle[] = [];
  const diskContent = stripArchivedMarksFromNode(cloneJson(doc.document), [], styles, blockStyles);
  const archive: TextStyleArchive | null =
    styles.length > 0 || blockStyles.length > 0
      ? {
          schemaVersion: ARCHIVE_SCHEMA_VERSION,
          contentHash: documentTextHash(diskContent),
          styles,
          blockStyles,
        }
      : null;
  const pluginData = withArchivePluginData(doc.pluginData, archive);

  return {
    appDocument: {
      ...doc,
      pluginData,
    },
    diskDocument: {
      ...doc,
      document: diskContent,
      pluginData,
    },
  };
}

export function restoreCompatibleTextStyles(doc: ScreenplayDocument): ScreenplayDocument {
  const archive = readArchive(doc.pluginData);
  if (!archive || (archive.styles.length === 0 && archive.blockStyles.length === 0)) {
    return doc;
  }

  if (documentTextHash(doc.document) !== archive.contentHash) {
    return doc;
  }

  const restoredDocument = cloneJson(doc.document);
  for (const style of archive.blockStyles) {
    const node = nodeAtPath(restoredDocument, style.path);
    if (!node || (style.type !== null && node.type !== style.type)) {
      continue;
    }

    node.attrs = {
      ...(node.attrs ?? {}),
      textAlign: style.textAlign,
    };
  }

  for (const style of archive.styles) {
    const node = nodeAtPath(restoredDocument, style.path);
    if (!node || typeof node.text !== 'string' || node.text !== style.text) {
      continue;
    }

    const marks = mergeStyleMarks(node.marks, style.marks);
    if (marks && marks.length > 0) {
      node.marks = marks;
    }
  }

  return {
    ...doc,
    document: restoredDocument,
  };
}
