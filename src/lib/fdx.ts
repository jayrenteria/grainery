import type { JSONContent } from '@tiptap/react';
import type { TitlePageData } from './types';

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
