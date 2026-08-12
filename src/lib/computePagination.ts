import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  LINES_PER_PAGE,
  CONTENT_WIDTH_PT,
  DIALOGUE_WIDTH_PT,
  PARENTHETICAL_WIDTH_PT,
  CHAR_WIDTH_PT,
} from './paginationConstants';
import type { DocumentMode } from './types';

export interface PageBreakInfo {
  pos: number; // ProseMirror position where we show a visual break (before node)
  page: number; // page number *after* the break
  isManual: boolean; // true if this is a manual page break node
}

export interface PaginationResult {
  breaks: PageBreakInfo[];
  totalPages: number;
  nodePageMap: Map<number, number>; // Maps node position to page number
}

/**
 * Wraps text to fit within a maximum width, matching Rust's wrap_text function
 */
function wrapText(text: string, maxWidthPt: number): string[] {
  const maxChars = Math.floor(maxWidthPt / CHAR_WIDTH_PT);
  if (maxChars <= 0) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  if (!lines.length) lines.push('');

  return lines;
}

function blockLines(node: ProseMirrorNode): number {
  const text = node.textContent.trim();
  if (!text && node.type.name !== 'sceneHeading') return 0;

  switch (node.type.name) {
    case 'comicPage': return 2;
    case 'comicPanel': return 3;
    case 'caption':
    case 'soundEffect': return wrapText(text, CONTENT_WIDTH_PT).length;
    case 'sceneHeading': return 3;
    case 'action': return 1 + wrapText(text, CONTENT_WIDTH_PT).length;
    case 'character': return 2;
    case 'dialogue': return wrapText(text, DIALOGUE_WIDTH_PT).length;
    case 'parenthetical': return wrapText(`(${text})`, PARENTHETICAL_WIDTH_PT).length;
    case 'transition': return 3;
    case 'pageBreak': return 0;
    default: return 1 + wrapText(text, CONTENT_WIDTH_PT).length;
  }
}

/**
 * Computes pagination for a ProseMirror document, mirroring the Rust PDF logic exactly.
 * This ensures WYSIWYG: what you see in the editor matches the PDF output.
 */
export function computePagination(doc: ProseMirrorNode, _documentMode: DocumentMode = 'screenplay'): PaginationResult {
  let page = 1;
  let lineCursor = 0;
  const breaks: PageBreakInfo[] = [];
  const nodePageMap = new Map<number, number>();

  const checkPageBreak = (linesNeeded: number, nodePos: number, isManual = false): boolean => {
    if (lineCursor + linesNeeded > LINES_PER_PAGE) {
      page += 1;
      lineCursor = 0;
      breaks.push({ pos: nodePos, page, isManual });
      return true;
    }
    return false;
  };

  const consumeLines = (count: number) => {
    lineCursor += count;
  };

  const characterFollowingLines = (characterIndex: number): number => {
    let lines = 0;
    let index = characterIndex + 1;
    while (index < doc.childCount && doc.child(index).type.name === 'parenthetical') {
      lines += blockLines(doc.child(index));
      index += 1;
    }

    const dialogue = index < doc.childCount ? doc.child(index) : null;
    return dialogue?.type.name === 'dialogue' && dialogue.textContent.trim()
      ? lines + blockLines(dialogue)
      : 0;
  };

  const nextKeptBlockLines = (index: number): number => {
    while (index < doc.childCount) {
      const node = doc.child(index);
      if (node.type.name === 'pageBreak') return 0;
      const lines = blockLines(node);
      if (lines) {
        return lines + (node.type.name === 'character' ? characterFollowingLines(index) : 0);
      }
      index += 1;
    }
    return 0;
  };

  // Iterate through all top-level nodes
  doc.forEach((node, offset, index) => {
    const nodePos = offset;
    const type = node.type.name;
    const text = node.textContent.trim();

    // Skip empty non-pageBreak nodes (matching Rust behavior)
    if (!text && type !== 'pageBreak') {
      nodePageMap.set(nodePos, page);
      return;
    }

    // Record which page this node starts on
    nodePageMap.set(nodePos, page);

    switch (type) {
      case 'comicPage': {
        checkPageBreak(2, nodePos);
        consumeLines(1);
        consumeLines(1);
        break;
      }

      case 'comicPanel': {
        consumeLines(1);
        checkPageBreak(2, nodePos);
        consumeLines(1);
        consumeLines(1);
        break;
      }

      case 'caption':
      case 'soundEffect': {
        const wrapped = wrapText(text, CONTENT_WIDTH_PT);
        checkPageBreak(wrapped.length, nodePos);
        consumeLines(wrapped.length);
        break;
      }

      case 'sceneHeading': {
        // Rust: write_blank_line(); check_page_break(2); write_line(); write_blank_line();
        consumeLines(1); // blank before
        checkPageBreak(2 + nextKeptBlockLines(index + 1), nodePos);
        consumeLines(1); // heading line
        consumeLines(1); // blank after
        break;
      }

      case 'action': {
        // Rust: write_blank_line(); wrapped = wrap_text(...); check_page_break(wrapped.len()); for line in wrapped { write_line }
        consumeLines(1); // blank before
        const wrapped = wrapText(text, CONTENT_WIDTH_PT);
        checkPageBreak(wrapped.length, nodePos);
        consumeLines(wrapped.length);
        break;
      }

      case 'character': {
        // Rust: write_blank_line(); check_page_break(1); write_line(...)
        consumeLines(1); // blank before
        checkPageBreak(1 + characterFollowingLines(index), nodePos);
        consumeLines(1); // character name line
        break;
      }

      case 'dialogue': {
        // Rust: wrapped = wrap_text(..., DIALOGUE_WIDTH); check_page_break(wrapped.len()); for line in wrapped { write_line }
        const wrapped = wrapText(text, DIALOGUE_WIDTH_PT);
        checkPageBreak(wrapped.length, nodePos);
        consumeLines(wrapped.length);
        break;
      }

      case 'parenthetical': {
        // Rust: paren_text = format!("({})", text); wrapped = wrap_text(..., PARENTHETICAL_WIDTH); ...
        const parenText = `(${text})`;
        const wrapped = wrapText(parenText, PARENTHETICAL_WIDTH_PT);
        checkPageBreak(wrapped.length, nodePos);
        consumeLines(wrapped.length);
        break;
      }

      case 'transition': {
        // Rust: write_blank_line(); check_page_break(2); write_line(); write_blank_line();
        consumeLines(1); // blank before
        checkPageBreak(2, nodePos); // text + blank after
        consumeLines(1); // transition line
        consumeLines(1); // blank after
        break;
      }

      case 'pageBreak': {
        // Manual page break - always forces a new page
        page += 1;
        lineCursor = 0;
        breaks.push({ pos: nodePos, page, isManual: true });
        break;
      }

      default: {
        // Unknown node type - treat like action (matches Rust fallback)
        if (!text) break;
        consumeLines(1); // blank before
        const wrapped = wrapText(text, CONTENT_WIDTH_PT);
        checkPageBreak(wrapped.length, nodePos);
        consumeLines(wrapped.length);
        break;
      }
    }
  });

  return { breaks, totalPages: page, nodePageMap };
}
