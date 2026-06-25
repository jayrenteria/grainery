import type { JSONContent } from '@tiptap/react';
import type { TitlePageData } from './types';

/**
 * Export a screenplay document to Fountain format
 * https://fountain.io/syntax
 */
export function exportToFountain(
  content: JSONContent,
  titlePage: TitlePageData | null
): string {
  const lines: string[] = [];

  // Title page
  if (titlePage) {
    lines.push(formatTitlePage(titlePage));
    lines.push(''); // Blank line separates title page from content
  }

  // Content
  if (content.content) {
    for (const node of content.content) {
      const fountainText = nodeToFountain(node);
      if (fountainText !== null) {
        lines.push(fountainText);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format title page in Fountain key: value format
 */
function formatTitlePage(tp: TitlePageData): string {
  const fields: string[] = [];

  if (tp.title) {
    fields.push(`Title: ${tp.title}`);
  }
  if (tp.credit) {
    fields.push(`Credit: ${tp.credit}`);
  }
  if (tp.author) {
    fields.push(`Author: ${tp.author}`);
  }
  if (tp.source) {
    fields.push(`Source: ${tp.source}`);
  }
  if (tp.draftDate) {
    fields.push(`Draft date: ${tp.draftDate}`);
  }
  if (tp.contact) {
    // Multi-line contact info needs proper indentation
    const contactLines = tp.contact.split('\n');
    if (contactLines.length > 1) {
      fields.push(`Contact:`);
      for (const line of contactLines) {
        fields.push(`    ${line}`);
      }
    } else {
      fields.push(`Contact: ${tp.contact}`);
    }
  }
  if (tp.copyright) {
    fields.push(`Copyright: ${tp.copyright}`);
  }
  if (tp.notes) {
    // Notes in title page
    const notesLines = tp.notes.split('\n');
    if (notesLines.length > 1) {
      fields.push(`Notes:`);
      for (const line of notesLines) {
        fields.push(`    ${line}`);
      }
    } else {
      fields.push(`Notes: ${tp.notes}`);
    }
  }

  return fields.join('\n');
}

/**
 * Extract text content from a node
 */
function getNodeText(node: JSONContent): string {
  if (node.text) {
    return node.text;
  }
  if (node.content) {
    return node.content.map(getNodeText).join('');
  }
  return '';
}

/**
 * Convert a single node to Fountain format
 */
function nodeToFountain(node: JSONContent): string | null {
  const text = getNodeText(node);

  switch (node.type) {
    case 'sceneHeading': {
      // Scene headings in Fountain are auto-detected if they start with INT./EXT.
      // We uppercase them for consistency
      const heading = text.toUpperCase();
      // If it doesn't start with a standard prefix, force it with a leading period
      if (/^(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)[\.\s]/i.test(heading)) {
        return `\n${heading}`;
      }
      // Force scene heading with period prefix
      return `\n.${heading}`;
    }

    case 'action': {
      // Action is plain text, preceded by blank line
      if (!text.trim()) return null;
      return `\n${text}`;
    }

    case 'character': {
      // Character names are uppercase, preceded by blank line
      const name = text.toUpperCase();
      const extension = node.attrs?.extension;
      if (extension) {
        return `\n${name} (${extension})`;
      }
      return `\n${name}`;
    }

    case 'parenthetical': {
      // Parentheticals are wrapped in parentheses, no blank line before
      return `(${text})`;
    }

    case 'dialogue': {
      // Dialogue follows character/parenthetical, no blank line before
      return text;
    }

    case 'transition': {
      // Transitions are right-aligned, uppercase
      const transitionText = text.toUpperCase();
      // If it ends with "TO:", Fountain auto-detects it
      if (transitionText.endsWith('TO:')) {
        return `\n${transitionText}`;
      }
      // Otherwise force with > prefix
      return `\n> ${transitionText}`;
    }

    case 'note': {
      // Notes are wrapped in [[double brackets]]
      return `[[${text}]]`;
    }

    case 'section': {
      // Sections use # prefix (1-3 levels)
      const level = (node.attrs?.level as number) || 1;
      const prefix = '#'.repeat(level);
      return `\n${prefix} ${text}`;
    }

    case 'pageBreak': {
      // Page breaks are ===
      return '\n===\n';
    }

    case 'dualDialogue': {
      // Dual dialogue: second character gets ^ suffix
      // This is complex - need to handle nested structure
      return formatDualDialogue(node);
    }

    default:
      // Unknown node type, just return text if any
      return text ? `\n${text}` : null;
  }
}

/**
 * Format dual dialogue block
 * In Fountain, dual dialogue is indicated by ^ after the second character name
 */
function formatDualDialogue(node: JSONContent): string {
  const lines: string[] = [];
  const columns = node.content || [];

  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    const isSecondColumn = i === 1;

    if (column.content) {
      for (const child of column.content) {
        if (child.type === 'character') {
          const name = getNodeText(child).toUpperCase();
          const extension = child.attrs?.extension;
          let charLine = extension ? `${name} (${extension})` : name;
          // Add ^ for dual dialogue on second character
          if (isSecondColumn) {
            charLine += ' ^';
          }
          lines.push(`\n${charLine}`);
        } else {
          const text = nodeToFountain(child);
          if (text !== null) {
            lines.push(text);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Parse Fountain format back to our document structure
 * (Basic implementation - can be expanded later)
 */
export function parseFountain(fountainText: string): {
  titlePage: TitlePageData | null;
  content: JSONContent;
} {
  const lines = fountainText.split('\n');
  const content: JSONContent[] = [];
  let titlePage: TitlePageData | null = null;

  let i = 0;

  // Check for title page (starts with Title:, Author:, etc.)
  if (lines[0]?.match(/^(Title|Author|Credit|Source|Draft date|Contact|Copyright|Notes):/i)) {
    const titlePageLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      titlePageLines.push(lines[i]);
      i++;
    }
    titlePage = parseTitlePageLines(titlePageLines);
    i++; // Skip blank line after title page
  }

  // Parse content
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Scene heading detection
    if (/^(INT|EXT|EST|INT\.?\/EXT|I\.?\/E)[\.\s]/i.test(trimmed) || trimmed.startsWith('.')) {
      const heading = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
      content.push({
        type: 'sceneHeading',
        content: [{ type: 'text', text: heading }],
      });
      i++;
      continue;
    }

    // Transition detection (ends with TO: or starts with >)
    if (trimmed.endsWith('TO:') || trimmed.startsWith('>')) {
      const transition = trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed;
      content.push({
        type: 'transition',
        content: [{ type: 'text', text: transition }],
      });
      i++;
      continue;
    }

    // Character detection (all caps, may have extension)
    if (trimmed === trimmed.toUpperCase() && /^[A-Z]/.test(trimmed) && !trimmed.includes('.')) {
      const match = trimmed.match(/^([A-Z][A-Z\s]+?)(?:\s*\((V\.O\.|O\.S\.|CONT'D|O\.C\.)\))?(?:\s*\^)?$/);
      if (match) {
        const charNode: JSONContent = {
          type: 'character',
          content: [{ type: 'text', text: match[1].trim() }],
        };
        if (match[2]) {
          charNode.attrs = { extension: match[2] };
        }
        content.push(charNode);
        i++;

        // Look for parenthetical and dialogue
        while (i < lines.length) {
          const nextLine = lines[i];
          const nextTrimmed = nextLine.trim();

          if (!nextTrimmed) {
            i++;
            break;
          }

          if (nextTrimmed.startsWith('(') && nextTrimmed.endsWith(')')) {
            content.push({
              type: 'parenthetical',
              content: [{ type: 'text', text: nextTrimmed.slice(1, -1) }],
            });
            i++;
          } else if (!nextTrimmed.match(/^[A-Z][A-Z\s]+$/) && !nextTrimmed.startsWith('.')) {
            content.push({
              type: 'dialogue',
              content: [{ type: 'text', text: nextTrimmed }],
            });
            i++;
          } else {
            break;
          }
        }
        continue;
      }
    }

    // Default to action
    content.push({
      type: 'action',
      content: [{ type: 'text', text: trimmed }],
    });
    i++;
  }

  return {
    titlePage,
    content: {
      type: 'doc',
      content: content.length > 0 ? content : [{ type: 'action', content: [] }],
    },
  };
}

function parseTitlePageLines(lines: string[]): TitlePageData {
  const data: TitlePageData = {
    title: '',
    author: '',
  };

  let currentKey: string | null = null;
  let currentValue: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z\s]+):\s*(.*)$/);
    if (match) {
      // Save previous key-value pair
      if (currentKey) {
        setTitlePageField(data, currentKey, currentValue.join('\n'));
      }
      currentKey = match[1].toLowerCase().trim();
      currentValue = match[2] ? [match[2]] : [];
    } else if (line.startsWith('    ') && currentKey) {
      // Continuation of multi-line value
      currentValue.push(line.trim());
    }
  }

  // Save last key-value pair
  if (currentKey) {
    setTitlePageField(data, currentKey, currentValue.join('\n'));
  }

  return data;
}

function setTitlePageField(data: TitlePageData, key: string, value: string): void {
  switch (key) {
    case 'title':
      data.title = value;
      break;
    case 'credit':
      data.credit = value;
      break;
    case 'author':
      data.author = value;
      break;
    case 'source':
      data.source = value;
      break;
    case 'draft date':
      data.draftDate = value;
      break;
    case 'contact':
      data.contact = value;
      break;
    case 'copyright':
      data.copyright = value;
      break;
    case 'notes':
      data.notes = value;
      break;
  }
}
