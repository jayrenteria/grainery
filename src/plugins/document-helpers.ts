import type { JSONContent } from '@tiptap/react';
import type { ScreenplayElementType } from '../lib/types';

export interface ScreenplayRange {
  from: number;
  to: number;
}

export interface ScreenplaySelection extends ScreenplayRange {
  currentElement: ScreenplayBlock | null;
}

export interface ScreenplayDocumentContext {
  selectionFrom?: number;
  selectionTo?: number;
  currentElementType?: ScreenplayElementType | null;
}

export interface ScreenplayBlock {
  id: string;
  index: number;
  type: string;
  text: string;
  from: number;
  to: number;
  size: number;
  attrs?: Record<string, unknown>;
  node: JSONContent;
}

export interface ScreenplayScene {
  id: string;
  index: number;
  number: number;
  heading: ScreenplayBlock;
  blocks: ScreenplayBlock[];
  text: string;
  from: number;
  to: number;
}

export interface ScreenplayDialogueBlock extends ScreenplayBlock {
  character: ScreenplayBlock | null;
  characterName: string | null;
}

export interface ScreenplayAnchor extends ScreenplayRange {
  text: string;
  prefix: string;
  suffix: string;
}

export interface ResolvedScreenplayAnchor extends ScreenplayRange {
  stale: boolean;
}

export interface ScreenplayBlockInput {
  type: ScreenplayElementType;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
}

export type ScreenplayBlockRef = number | { index?: number; position?: number };

interface TextSegment {
  from: number;
  to: number;
  text: string;
}

interface TextIndex {
  plainText: string;
  charPositions: number[];
  segments: TextSegment[];
}

const DEFAULT_CONTEXT_WINDOW = 24;

export class ScreenplayDocument {
  private document: JSONContent;
  private context: ScreenplayDocumentContext;

  constructor(document: JSONContent, context: ScreenplayDocumentContext = {}) {
    this.document = cloneJson(document);
    this.context = context;
  }

  static from(document: JSONContent, context: ScreenplayDocumentContext = {}): ScreenplayDocument {
    return new ScreenplayDocument(document, context);
  }

  toJSON(): JSONContent {
    return cloneJson(this.document);
  }

  get raw(): JSONContent {
    return this.toJSON();
  }

  get contentSize(): number {
    return getDocumentContentSize(this.document);
  }

  blocks(type?: ScreenplayElementType | ScreenplayElementType[]): ScreenplayBlock[] {
    const allowed = Array.isArray(type) ? new Set(type) : type ? new Set([type]) : null;
    const blocks = getTopLevelBlocks(this.document);
    return allowed ? blocks.filter((block) => allowed.has(block.type as ScreenplayElementType)) : blocks;
  }

  scenes(): ScreenplayScene[] {
    const blocks = this.blocks();
    const headingIndexes = blocks
      .filter((block) => block.type === 'sceneHeading')
      .map((block) => block.index);

    return headingIndexes.map((blockIndex, sceneIndex) => {
      const nextHeadingIndex = headingIndexes[sceneIndex + 1] ?? blocks.length;
      const sceneBlocks = blocks.slice(blockIndex, nextHeadingIndex);
      const heading = blocks[blockIndex];
      const last = sceneBlocks[sceneBlocks.length - 1] ?? heading;

      return {
        id: `scene-${sceneIndex + 1}`,
        index: sceneIndex,
        number: sceneIndex + 1,
        heading,
        blocks: sceneBlocks,
        text: sceneBlocks.map((block) => block.text).filter(Boolean).join('\n'),
        from: heading.from,
        to: last.to,
      };
    });
  }

  characters(): ScreenplayBlock[] {
    return this.blocks('character');
  }

  dialogue(): ScreenplayDialogueBlock[] {
    const blocks = this.blocks();
    return blocks
      .filter((block) => block.type === 'dialogue')
      .map((block) => {
        const character = findCharacterForDialogue(blocks, block.index);
        return {
          ...block,
          character,
          characterName: character ? normalizeWhitespace(character.text) : null,
        };
      });
  }

  actions(): ScreenplayBlock[] {
    return this.blocks('action');
  }

  plainText(options: { separator?: string; types?: ScreenplayElementType[] } = {}): string {
    const separator = options.separator ?? '\n';
    const blocks = this.blocks(options.types);
    return blocks.map((block) => block.text).join(separator);
  }

  currentElement(selectionFrom = this.context.selectionFrom): ScreenplayBlock | null {
    if (!Number.isFinite(selectionFrom)) {
      return null;
    }

    const position = Math.floor(Number(selectionFrom));
    return this.blocks().find((block) => position >= block.from && position <= block.to) ?? null;
  }

  selection(context: ScreenplayDocumentContext = this.context): ScreenplaySelection | null {
    if (!Number.isFinite(context.selectionFrom)) {
      return null;
    }

    const range = this.resolveRange({
      from: Number(context.selectionFrom),
      to: Number(context.selectionTo ?? context.selectionFrom),
    });

    return {
      ...range,
      currentElement: this.currentElement(range.from),
    };
  }

  resolveRange(input: Partial<ScreenplayRange> | null | undefined): ScreenplayRange {
    const maxPosition = Math.max(1, this.contentSize);
    const rawFrom = Number(input?.from);
    const rawTo = Number(input?.to ?? input?.from);
    const from = clampPosition(Number.isFinite(rawFrom) ? Math.floor(rawFrom) : 1, maxPosition);
    const to = clampPosition(Number.isFinite(rawTo) ? Math.floor(rawTo) : from, maxPosition);

    if (to < from) {
      return { from: to, to: from };
    }

    return { from, to };
  }

  extractText(range: Partial<ScreenplayRange>): string {
    const resolved = this.resolveRange(range);
    return extractTextRange(buildTextIndex(this.document).segments, resolved.from, resolved.to);
  }

  createAnchor(range: Partial<ScreenplayRange>, contextWindow = DEFAULT_CONTEXT_WINDOW): ScreenplayAnchor {
    const resolved = this.resolveRange(range);
    const index = buildTextIndex(this.document);
    const startChar = firstCharIndexAtOrAfter(index.charPositions, resolved.from);
    const endChar = firstCharIndexAtOrAfter(index.charPositions, resolved.to);

    return {
      ...resolved,
      text: extractTextRange(index.segments, resolved.from, resolved.to),
      prefix: index.plainText.slice(Math.max(0, startChar - contextWindow), startChar),
      suffix: index.plainText.slice(endChar, Math.min(index.plainText.length, endChar + contextWindow)),
    };
  }

  resolveAnchor(anchor: ScreenplayAnchor): ResolvedScreenplayAnchor {
    const range = this.resolveRange(anchor);
    const selectedText = anchor.text || '';
    const index = buildTextIndex(this.document);
    const currentRangeText = extractTextRange(index.segments, range.from, range.to);

    if (selectedText && currentRangeText === selectedText) {
      return { ...range, stale: false };
    }

    if (!selectedText && range.to > range.from) {
      return { ...range, stale: false };
    }

    if (!selectedText || index.plainText.length === 0) {
      return { ...range, stale: true };
    }

    let best: { from: number; to: number; score: number; distance: number } | null = null;
    let searchStart = 0;

    while (searchStart <= index.plainText.length - selectedText.length) {
      const found = index.plainText.indexOf(selectedText, searchStart);
      if (found === -1) {
        break;
      }

      const startPos = index.charPositions[found];
      const endPos = index.charPositions[found + selectedText.length - 1];
      if (Number.isFinite(startPos) && Number.isFinite(endPos)) {
        const candidateFrom = startPos;
        const candidateTo = endPos + 1;
        const candidatePrefix = index.plainText.slice(Math.max(0, found - anchor.prefix.length), found);
        const candidateSuffix = index.plainText.slice(
          found + selectedText.length,
          found + selectedText.length + anchor.suffix.length
        );
        let score = 0;
        if (!anchor.prefix || candidatePrefix === anchor.prefix) score += 1;
        if (!anchor.suffix || candidateSuffix === anchor.suffix) score += 1;

        const distance = Math.abs(candidateFrom - range.from);
        if (!best || score > best.score || (score === best.score && distance < best.distance)) {
          best = { from: candidateFrom, to: candidateTo, score, distance };
        }
      }

      searchStart = found + Math.max(selectedText.length, 1);
    }

    if (best && (best.score > 0 || best.distance === 0)) {
      return { from: best.from, to: best.to, stale: false };
    }

    return { ...range, stale: true };
  }

  appendBlock(input: ScreenplayBlockInput): this {
    this.ensureContent().push(createBlock(input));
    return this;
  }

  insertBlock(index: number, input: ScreenplayBlockInput): this {
    const content = this.ensureContent();
    const safeIndex = Math.min(Math.max(Math.floor(index), 0), content.length);
    content.splice(safeIndex, 0, createBlock(input));
    return this;
  }

  replaceBlock(ref: ScreenplayBlockRef, input: ScreenplayBlockInput): this {
    const index = this.findBlockIndex(ref);
    if (index >= 0) {
      this.ensureContent()[index] = createBlock(input);
    }
    return this;
  }

  deleteBlock(ref: ScreenplayBlockRef): this {
    const index = this.findBlockIndex(ref);
    if (index >= 0) {
      this.ensureContent().splice(index, 1);
    }
    return this;
  }

  setBlockText(ref: ScreenplayBlockRef, text: string): this {
    const index = this.findBlockIndex(ref);
    if (index >= 0) {
      const block = this.ensureContent()[index];
      block.content = text ? [{ type: 'text', text }] : [];
    }
    return this;
  }

  trimTrailingWhitespace(): this {
    trimTextNodes(this.document, (text) => text.replace(/\s+$/g, ''));
    return this;
  }

  private ensureContent(): JSONContent[] {
    if (!Array.isArray(this.document.content)) {
      this.document.content = [];
    }

    return this.document.content;
  }

  private findBlockIndex(ref: ScreenplayBlockRef): number {
    if (typeof ref === 'number') {
      return ref >= 0 ? Math.floor(ref) : -1;
    }

    if (Number.isFinite(ref.index)) {
      return Math.max(0, Math.floor(Number(ref.index)));
    }

    if (Number.isFinite(ref.position)) {
      const position = Math.floor(Number(ref.position));
      const found = this.blocks().find((block) => position >= block.from && position <= block.to);
      return found?.index ?? -1;
    }

    return -1;
  }
}

export function createScreenplayDocument(
  document: JSONContent,
  context: ScreenplayDocumentContext = {}
): ScreenplayDocument {
  return ScreenplayDocument.from(document, context);
}

export function isScreenplayDocument(value: unknown): value is ScreenplayDocument {
  return value instanceof ScreenplayDocument;
}

function createBlock(input: ScreenplayBlockInput): JSONContent {
  return {
    type: input.type,
    attrs: input.attrs,
    content: input.content ? cloneJson(input.content) : input.text ? [{ type: 'text', text: input.text }] : [],
  };
}

function getTopLevelBlocks(document: JSONContent): ScreenplayBlock[] {
  const content = Array.isArray(document.content) ? document.content : [];
  const blocks: ScreenplayBlock[] = [];
  let position = 1;

  for (let index = 0; index < content.length; index += 1) {
    const node = content[index];
    const size = Math.max(getNodeSize(node), 1);
    blocks.push({
      id: `block-${index + 1}`,
      index,
      type: String(node.type ?? ''),
      text: readNodeText(node),
      from: position,
      to: position + size,
      size,
      attrs: node.attrs as Record<string, unknown> | undefined,
      node,
    });
    position += size;
  }

  return blocks;
}

function findCharacterForDialogue(blocks: ScreenplayBlock[], dialogueIndex: number): ScreenplayBlock | null {
  for (let index = dialogueIndex - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === 'character') {
      return block;
    }
    if (block.type !== 'parenthetical') {
      return null;
    }
  }

  return null;
}

function readNodeText(node: JSONContent | undefined): string {
  if (!node) {
    return '';
  }

  if (typeof node.text === 'string') {
    return node.text;
  }

  const children = Array.isArray(node.content) ? node.content : [];
  return children.map(readNodeText).join('');
}

function getNodeSize(node: JSONContent | undefined): number {
  if (!node) {
    return 0;
  }

  if (typeof node.text === 'string') {
    return node.text.length;
  }

  const children = Array.isArray(node.content) ? node.content : [];
  return children.reduce((size, child) => size + getNodeSize(child), 2);
}

function getDocumentContentSize(document: JSONContent): number {
  const children = Array.isArray(document.content) ? document.content : [];
  return children.reduce((size, child) => size + Math.max(getNodeSize(child), 1), 0);
}

function walkTextNodes(node: JSONContent | undefined, startPos: number, onTextNode: (pos: number, text: string) => void): void {
  if (!node) {
    return;
  }

  if (typeof node.text === 'string') {
    onTextNode(startPos, node.text);
    return;
  }

  const children = Array.isArray(node.content) ? node.content : [];
  let position = startPos + 1;

  for (const child of children) {
    walkTextNodes(child, position, onTextNode);
    position += getNodeSize(child);
  }
}

function buildTextIndex(document: JSONContent): TextIndex {
  const segments: TextSegment[] = [];
  const charPositions: number[] = [];
  let plainText = '';
  const blocks = Array.isArray(document.content) ? document.content : [];
  let position = 1;

  for (const block of blocks) {
    walkTextNodes(block, position, (textPos, text) => {
      if (!text) {
        return;
      }

      segments.push({ from: textPos, to: textPos + text.length, text });
      for (let index = 0; index < text.length; index += 1) {
        charPositions.push(textPos + index);
      }
      plainText += text;
    });
    position += Math.max(getNodeSize(block), 1);
  }

  return { plainText, charPositions, segments };
}

function extractTextRange(segments: TextSegment[], from: number, to: number): string {
  const chunks: string[] = [];

  for (const segment of segments) {
    if (segment.to <= from || segment.from >= to) {
      continue;
    }

    const start = Math.max(from, segment.from);
    const end = Math.min(to, segment.to);
    chunks.push(segment.text.slice(start - segment.from, end - segment.from));
  }

  return chunks.join('');
}

function firstCharIndexAtOrAfter(charPositions: number[], pmPosition: number): number {
  for (let index = 0; index < charPositions.length; index += 1) {
    if (charPositions[index] >= pmPosition) {
      return index;
    }
  }

  return charPositions.length;
}

function trimTextNodes(node: JSONContent | undefined, transform: (text: string) => string): void {
  if (!node) {
    return;
  }

  if (typeof node.text === 'string') {
    node.text = transform(node.text);
    return;
  }

  for (const child of Array.isArray(node.content) ? node.content : []) {
    trimTextNodes(child, transform);
  }
}

function clampPosition(position: number, maxPosition: number): number {
  return Math.min(Math.max(position, 1), maxPosition);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
