import type { JSONContent } from '@tiptap/react';
import type { CharacterExtension, TitlePageData } from './types';

export interface ImportedFdxDocument {
  document: JSONContent;
  titlePage: TitlePageData | null;
}

const FDX_TO_NODE_TYPE: Record<string, string> = {
  'Scene Heading': 'sceneHeading',
  Action: 'action',
  Character: 'character',
  Parenthetical: 'parenthetical',
  Dialogue: 'dialogue',
  Transition: 'transition',
};

const CHARACTER_EXTENSION_PATTERN = /\s+\((V\.O\.|O\.S\.|CONT'D|O\.C\.)\)$/i;
const SUPPORTED_CHARACTER_EXTENSIONS: CharacterExtension[] = ['V.O.', 'O.S.', "CONT'D", 'O.C.'];

/**
 * Export a screenplay document to Final Draft FDX format
 * FDX is an XML-based format used by Final Draft software
 */
export function exportToFdx(
  content: JSONContent,
  titlePage: TitlePageData | null
): string {
  const paragraphs: string[] = [];

  if (content.content) {
    for (const node of content.content) {
      const fdxParagraph = nodeToFdx(node);
      if (fdxParagraph) {
        paragraphs.push(fdxParagraph);
      }
    }
  }

  const titlePageXml = titlePage ? formatTitlePage(titlePage) : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
${titlePageXml}
  <Content>
${paragraphs.join('\n')}
  </Content>
  <ElementSettings Type="Scene Heading">
    <FontSpec Font="Courier Final Draft" Size="12" Style="AllCaps"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" LeftIndent="1.50" RightIndent="7.50" SpaceBefore="24" Spacing="1"/>
    <Behavior PaginateAs="Scene Heading" ReturnKey="Action" Shortcut="1"/>
  </ElementSettings>
  <ElementSettings Type="Action">
    <FontSpec Font="Courier Final Draft" Size="12" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" LeftIndent="1.50" RightIndent="7.50" SpaceBefore="12" Spacing="1"/>
    <Behavior PaginateAs="Action" ReturnKey="Action" Shortcut="2"/>
  </ElementSettings>
  <ElementSettings Type="Character">
    <FontSpec Font="Courier Final Draft" Size="12" Style="AllCaps"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" LeftIndent="3.70" RightIndent="7.50" SpaceBefore="12" Spacing="1"/>
    <Behavior PaginateAs="Character" ReturnKey="Dialogue" Shortcut="3"/>
  </ElementSettings>
  <ElementSettings Type="Parenthetical">
    <FontSpec Font="Courier Final Draft" Size="12" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" LeftIndent="3.10" RightIndent="5.50" SpaceBefore="0" Spacing="1"/>
    <Behavior PaginateAs="Parenthetical" ReturnKey="Dialogue" Shortcut="4"/>
  </ElementSettings>
  <ElementSettings Type="Dialogue">
    <FontSpec Font="Courier Final Draft" Size="12" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" LeftIndent="2.50" RightIndent="6.00" SpaceBefore="0" Spacing="1"/>
    <Behavior PaginateAs="Dialogue" ReturnKey="Action" Shortcut="5"/>
  </ElementSettings>
  <ElementSettings Type="Transition">
    <FontSpec Font="Courier Final Draft" Size="12" Style="AllCaps"/>
    <ParagraphSpec Alignment="Right" FirstIndent="0.00" LeftIndent="6.00" RightIndent="7.50" SpaceBefore="12" Spacing="1"/>
    <Behavior PaginateAs="Transition" ReturnKey="Scene Heading" Shortcut="6"/>
  </ElementSettings>
  <PageLayout>
    <PageSize Height="11.00" Width="8.50"/>
    <Margins Bottom="1.00" Left="1.50" Right="1.00" Top="1.00"/>
  </PageLayout>
</FinalDraft>`;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getNodeText(node: JSONContent): string {
  if (node.text) {
    return node.text;
  }
  if (node.content) {
    return node.content.map(getNodeText).join('');
  }
  return '';
}

function formatTitlePage(tp: TitlePageData): string {
  const fields: string[] = [];

  if (tp.title) {
    fields.push(`      <Paragraph Type="Text">
        <Text>${escapeXml(tp.title)}</Text>
      </Paragraph>`);
  }
  if (tp.credit) {
    fields.push(`      <Paragraph Type="Text">
        <Text>${escapeXml(tp.credit)}</Text>
      </Paragraph>`);
  }
  if (tp.author) {
    fields.push(`      <Paragraph Type="Text">
        <Text>${escapeXml(tp.author)}</Text>
      </Paragraph>`);
  }
  if (tp.contact) {
    fields.push(`      <Paragraph Type="Text">
        <Text>${escapeXml(tp.contact)}</Text>
      </Paragraph>`);
  }

  if (fields.length === 0) return '';

  return `  <TitlePage>
    <Content>
${fields.join('\n')}
    </Content>
  </TitlePage>`;
}

function nodeToFdx(node: JSONContent): string | null {
  const text = getNodeText(node);

  switch (node.type) {
    case 'sceneHeading': {
      const heading = text.toUpperCase();
      return `    <Paragraph Type="Scene Heading" id="${generateUUID()}">
      <SceneProperties Length="1" Page="1" Title=""/>
      <Text Style="Bold+AllCaps">${escapeXml(heading)}</Text>
    </Paragraph>`;
    }

    case 'action': {
      if (!text.trim()) return null;
      return `    <Paragraph Type="Action" id="${generateUUID()}">
      <Text>${escapeXml(text)}</Text>
    </Paragraph>`;
    }

    case 'character': {
      const name = text.toUpperCase();
      const extension = node.attrs?.extension;
      const fullName = extension ? `${name} (${extension})` : name;
      return `    <Paragraph Type="Character" id="${generateUUID()}">
      <Text>${escapeXml(fullName)}</Text>
    </Paragraph>`;
    }

    case 'parenthetical': {
      const parenText = text.startsWith('(') ? text : `(${text})`;
      return `    <Paragraph Type="Parenthetical" id="${generateUUID()}">
      <Text>${escapeXml(parenText)}</Text>
    </Paragraph>`;
    }

    case 'dialogue': {
      return `    <Paragraph Type="Dialogue" id="${generateUUID()}">
      <Text>${escapeXml(text)}</Text>
    </Paragraph>`;
    }

    case 'transition': {
      const transitionText = text.toUpperCase();
      return `    <Paragraph Type="Transition" id="${generateUUID()}">
      <Text Style="AllCaps">${escapeXml(transitionText)}</Text>
    </Paragraph>`;
    }

    case 'pageBreak': {
      return `    <Paragraph Type="Action" id="${generateUUID()}">
      <Text></Text>
    </Paragraph>`;
    }

    default:
      if (text.trim()) {
        return `    <Paragraph Type="Action" id="${generateUUID()}">
      <Text>${escapeXml(text)}</Text>
    </Paragraph>`;
      }
      return null;
  }
}

/**
 * Import Final Draft FDX XML into Grainery's TipTap document format.
 */
export function importFromFdx(fdxContent: string): ImportedFdxDocument {
  const parser = new DOMParser();
  const xml = parser.parseFromString(fdxContent, 'application/xml');
  const parserError = xml.querySelector('parsererror');

  if (parserError) {
    throw new Error('The selected Final Draft file could not be parsed as XML.');
  }

  const finalDraft = xml.querySelector('FinalDraft');
  if (!finalDraft) {
    throw new Error('The selected file is not a valid Final Draft document.');
  }

  const content = finalDraft.querySelector(':scope > Content');
  if (!content) {
    throw new Error('The selected Final Draft file does not contain script content.');
  }

  const nodes = Array.from(content.children).flatMap(importContentElement);

  return {
    document: {
      type: 'doc',
      content: nodes.length > 0 ? nodes : [{ type: 'sceneHeading', content: [] }],
    },
    titlePage: importTitlePage(finalDraft),
  };
}

function importContentElement(element: Element): JSONContent[] {
  if (element.tagName === 'Paragraph') {
    const node = paragraphToNode(element);
    return node ? [node] : [];
  }

  if (element.tagName === 'PageBreak') {
    return [{ type: 'pageBreak' }];
  }

  return Array.from(element.children).flatMap(importContentElement);
}

function paragraphToNode(paragraph: Element): JSONContent | null {
  const fdxType = paragraph.getAttribute('Type') || 'Action';
  const nodeType = FDX_TO_NODE_TYPE[fdxType] ?? 'action';
  const textContent = collectParagraphText(paragraph).trimEnd();
  const textNodes = collectTextNodes(paragraph, canImportMarks(nodeType));

  if (isManualPageBreak(paragraph, textContent)) {
    return { type: 'pageBreak' };
  }

  if (!textContent.trim() && nodeType === 'action') {
    return null;
  }

  if (nodeType === 'character') {
    const { name, extension } = splitCharacterExtension(textContent);
    return {
      type: 'character',
      attrs: { extension },
      content: name ? [{ type: 'text', text: name }] : [],
    };
  }

  const content = textNodes.length > 0 ? textNodes : textContent ? [{ type: 'text', text: textContent }] : [];

  return {
    type: nodeType,
    ...(nodeType === 'sceneHeading' ? { attrs: { sceneNumber: paragraph.getAttribute('Number') ?? null } } : {}),
    ...(content.length > 0 ? { content } : { content: [] }),
  };
}

function importTitlePage(finalDraft: Element): TitlePageData | null {
  const titlePage = finalDraft.querySelector(':scope > TitlePage');
  const titlePageContent = titlePage?.querySelector(':scope > Content');
  if (!titlePageContent) {
    return null;
  }

  const paragraphs = Array.from(titlePageContent.querySelectorAll(':scope > Paragraph'))
    .map((paragraph) => collectParagraphText(paragraph).trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return null;
  }

  return {
    title: paragraphs[0] ?? '',
    credit: paragraphs[1],
    author: paragraphs[2] ?? '',
    contact: paragraphs.slice(3).join('\n') || undefined,
  };
}

function collectParagraphText(paragraph: Element): string {
  const textElements = Array.from(paragraph.getElementsByTagName('Text'));
  return textElements.map(collectText).join('');
}

function collectText(element: Element): string {
  return Array.from(element.childNodes)
    .map((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        return child.textContent ?? '';
      }

      if (child.nodeType === Node.ELEMENT_NODE) {
        return collectText(child as Element);
      }

      return '';
    })
    .join('');
}

function collectTextNodes(paragraph: Element, includeMarks: boolean): JSONContent[] {
  const nodes: JSONContent[] = [];

  const visit = (element: Element, inheritedMarks: JSONContent['marks'] = []) => {
    const nextMarks = includeMarks ? mergeMarks(inheritedMarks, getMarks(element)) : [];

    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text) {
          nodes.push({
            type: 'text',
            text,
            ...(nextMarks && nextMarks.length > 0 ? { marks: nextMarks } : {}),
          });
        }
        continue;
      }

      if (child.nodeType === Node.ELEMENT_NODE) {
        visit(child as Element, nextMarks);
      }
    }
  };

  for (const textElement of Array.from(paragraph.getElementsByTagName('Text'))) {
    visit(textElement);
  }

  return nodes.filter((node) => typeof node.text === 'string' && node.text.length > 0);
}

function getMarks(element: Element): JSONContent['marks'] {
  if (element.tagName !== 'Text') {
    return [];
  }

  const style = element.getAttribute('Style') ?? '';
  const marks: JSONContent['marks'] = [];
  if (/\bBold\b/i.test(style)) marks.push({ type: 'bold' });
  if (/\bItalic\b/i.test(style)) marks.push({ type: 'italic' });
  if (/\bUnderline\b/i.test(style)) marks.push({ type: 'underline' });
  return marks;
}

function mergeMarks(
  baseMarks: JSONContent['marks'] = [],
  additionalMarks: JSONContent['marks'] = []
): JSONContent['marks'] {
  const merged = [...baseMarks];

  for (const mark of additionalMarks) {
    if (!merged.some((existing) => existing.type === mark.type)) {
      merged.push(mark);
    }
  }

  return merged;
}

function canImportMarks(nodeType: string): boolean {
  return nodeType === 'action' || nodeType === 'dialogue';
}

function splitCharacterExtension(text: string): { name: string; extension: CharacterExtension } {
  const match = text.match(CHARACTER_EXTENSION_PATTERN);
  if (!match) {
    return { name: text, extension: null };
  }

  const extension = SUPPORTED_CHARACTER_EXTENSIONS.find(
    (item) => item?.toUpperCase() === match[1].toUpperCase()
  ) ?? null;

  return {
    name: text.slice(0, match.index).trimEnd(),
    extension,
  };
}

function isManualPageBreak(paragraph: Element, textContent: string): boolean {
  const startsNewPage = paragraph.getAttribute('StartsNewPage') === 'Yes';
  return startsNewPage && textContent.trim().length === 0;
}
