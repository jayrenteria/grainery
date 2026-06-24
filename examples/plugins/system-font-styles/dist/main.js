const COMMON_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const ALIGNABLE_NODE_TYPES = new Set([
  'sceneHeading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'comicPage',
  'comicPanel',
  'caption',
  'soundEffect',
  'title',
  'heading',
  'body',
  'bulletItem',
  'numberedItem'
]);
const TEXT_STYLE_MARKS = new Set(['fontFamily', 'textSize']);
const MAX_FONT_FAMILY_LENGTH = 128;
const MAX_FONT_MATCHES = 16;
const MAX_VARIANTS_PER_FAMILY = 5;

let cachedFonts = null;
let fontPermissionDenied = false;
let fontActionMap = new Map();

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\u0000/g, '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

function normalizeFontName(value) {
  return cleanString(value, MAX_FONT_FAMILY_LENGTH).replace(/^\.+/, '').trim();
}

function normalizeFontWeight(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'normal') {
      return 400;
    }
    if (lower === 'bold') {
      return 700;
    }
  }

  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.min(1000, Math.max(1, Math.round(numeric)));
}

function normalizeFontStyle(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const style = value.trim().toLowerCase();
  return style === 'normal' || style === 'italic' || style === 'oblique' ? style : null;
}

function normalizeSize(value) {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.round(Math.min(72, Math.max(6, numeric)) * 10) / 10;
}

function normalizeFamilies(input) {
  const byName = new Map();
  const families = Array.isArray(input) ? input : [];

  for (const family of families) {
    const name = normalizeFontName(family && family.name);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const entry = byName.get(key) || { name, variants: [] };
    const seenVariants = new Set(
      entry.variants.map((variant) => `${variant.name.toLowerCase()}:${variant.weight || ''}:${variant.style || ''}`)
    );

    for (const variant of Array.isArray(family.variants) ? family.variants : []) {
      const variantName = cleanString(variant && variant.name, 128) || 'Regular';
      const weight = normalizeFontWeight(variant && variant.weight);
      const style = normalizeFontStyle(variant && variant.style) || 'normal';
      const variantKey = `${variantName.toLowerCase()}:${weight || ''}:${style}`;
      if (seenVariants.has(variantKey)) {
        continue;
      }
      seenVariants.add(variantKey);
      entry.variants.push({ name: variantName, weight, style });
    }

    if (entry.variants.length === 0) {
      entry.variants.push({ name: 'Regular', weight: 400, style: 'normal' });
    }
    byName.set(key, entry);
  }

  return Array.from(byName.values())
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .map((family) => ({
      ...family,
      variants: family.variants.sort((left, right) => {
        const weightOrder = (left.weight || 400) - (right.weight || 400);
        if (weightOrder !== 0) {
          return weightOrder;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      })
    }));
}

async function loadFonts(api, forceRefresh = false) {
  if (!forceRefresh && cachedFonts) {
    return { granted: true, families: cachedFonts };
  }

  if (!forceRefresh && fontPermissionDenied) {
    return { granted: false, families: [] };
  }

  const granted = await api.requestPermission('system:fonts');
  if (!granted) {
    fontPermissionDenied = true;
    return { granted: false, families: [] };
  }

  fontPermissionDenied = false;
  const response = await api.hostCall('system:list_fonts', {});
  cachedFonts = normalizeFamilies(response && response.families);
  return { granted: true, families: cachedFonts };
}

function getNodeSize(node) {
  if (!node) {
    return 0;
  }

  if (typeof node.text === 'string') {
    return node.text.length;
  }

  const children = Array.isArray(node.content) ? node.content : [];
  return children.reduce((size, child) => size + getNodeSize(child), 2);
}

function normalizeMarks(marks) {
  if (!Array.isArray(marks)) {
    return [];
  }

  const seen = new Set();
  const output = [];
  for (const mark of marks) {
    if (!mark || typeof mark.type !== 'string') {
      continue;
    }
    const next = mark.attrs ? { type: mark.type, attrs: { ...mark.attrs } } : { type: mark.type };
    const key = JSON.stringify(next);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(next);
    }
  }

  return output;
}

function buildTextNode(text, marks) {
  const node = { type: 'text', text };
  if (marks.length > 0) {
    node.marks = marks;
  }
  return node;
}

function withMark(marks, mark) {
  return [...normalizeMarks(marks).filter((item) => item.type !== mark.type), mark];
}

function withoutTextStyleMarks(marks) {
  return normalizeMarks(marks).filter((item) => !TEXT_STYLE_MARKS.has(item.type));
}

function splitTextNode(node, textPos, from, to, applyMarks) {
  const text = typeof node.text === 'string' ? node.text : '';
  const start = Math.max(0, from - textPos);
  const end = Math.min(text.length, to - textPos);

  if (start >= end) {
    return { changed: false, nodes: [cloneJson(node)] };
  }

  const parts = [];
  const baseMarks = normalizeMarks(node.marks);
  if (start > 0) {
    parts.push(buildTextNode(text.slice(0, start), baseMarks));
  }

  parts.push(buildTextNode(text.slice(start, end), applyMarks(baseMarks)));

  if (end < text.length) {
    parts.push(buildTextNode(text.slice(end), baseMarks));
  }

  return { changed: true, nodes: parts };
}

function transformNodeText(node, startPos, from, to, applyMarks) {
  if (!node) {
    return { changed: false, nodes: [] };
  }

  if (typeof node.text === 'string') {
    return splitTextNode(node, startPos, from, to, applyMarks);
  }

  const next = { ...node };
  const children = Array.isArray(node.content) ? node.content : [];
  if (children.length === 0) {
    return { changed: false, nodes: [next] };
  }

  let childPos = startPos + 1;
  let changed = false;
  const nextContent = [];
  for (const child of children) {
    const result = transformNodeText(child, childPos, from, to, applyMarks);
    nextContent.push(...result.nodes);
    changed = changed || result.changed;
    childPos += getNodeSize(child);
  }

  next.content = nextContent;
  return { changed, nodes: [next] };
}

function applyMarksToSelection(document, from, to, applyMarks) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    return { changed: false, document };
  }

  const rangeFrom = Math.min(from, to);
  const rangeTo = Math.max(from, to);
  const next = cloneJson(document);
  const blocks = Array.isArray(next.content) ? next.content : [];
  let position = 1;
  let changed = false;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const size = Math.max(getNodeSize(block), 1);
    if (position < rangeTo && position + size > rangeFrom) {
      const result = transformNodeText(block, position, rangeFrom, rangeTo, applyMarks);
      blocks[index] = result.nodes[0] || block;
      changed = changed || result.changed;
    }
    position += size;
  }

  return { changed, document: next };
}

function applyFontToSelection(document, context, family, variant) {
  const fontFamily = normalizeFontName(family);
  if (!fontFamily) {
    return { changed: false, document };
  }

  const mark = {
    type: 'fontFamily',
    attrs: {
      fontFamily,
      fontWeight: normalizeFontWeight(variant && variant.weight),
      fontStyle: normalizeFontStyle(variant && variant.style)
    }
  };

  return applyMarksToSelection(document, context.selectionFrom, context.selectionTo, (marks) => withMark(marks, mark));
}

function applySizeToSelection(document, context, sizePt) {
  const size = normalizeSize(sizePt);
  if (!size) {
    return { changed: false, document };
  }

  return applyMarksToSelection(document, context.selectionFrom, context.selectionTo, (marks) =>
    withMark(marks, { type: 'textSize', attrs: { sizePt: size } })
  );
}

function clearStylesInSelection(document, context) {
  return applyMarksToSelection(document, context.selectionFrom, context.selectionTo, withoutTextStyleMarks);
}

function applyAlignment(document, context, alignment) {
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') {
    return { changed: false, document };
  }

  const next = cloneJson(document);
  const blocks = Array.isArray(next.content) ? next.content : [];
  const from = Number.isFinite(context.selectionFrom) ? context.selectionFrom : 1;
  const to = Number.isFinite(context.selectionTo) ? context.selectionTo : from;
  const rangeFrom = Math.min(from, to);
  const rangeTo = Math.max(from, to);
  const empty = rangeFrom === rangeTo;
  let position = 1;
  let changed = false;

  for (const block of blocks) {
    const size = Math.max(getNodeSize(block), 1);
    const blockFrom = position;
    const blockTo = position + size;
    const matches = empty
      ? rangeFrom >= blockFrom && rangeFrom <= blockTo
      : blockFrom < rangeTo && blockTo > rangeFrom;

    if (matches && ALIGNABLE_NODE_TYPES.has(block.type)) {
      const attrs = { ...(block.attrs || {}), textAlign: alignment };
      if (block.attrs && block.attrs.textAlign === alignment) {
        position += size;
        continue;
      }
      block.attrs = attrs;
      changed = true;
    }

    position += size;
  }

  return { changed, document: next };
}

function matchFonts(families, query) {
  const normalized = cleanString(query, 80).toLowerCase();
  const matches = normalized
    ? families.filter((family) => family.name.toLowerCase().includes(normalized))
    : families;

  return matches.slice(0, MAX_FONT_MATCHES);
}

function buildFontResultBlocks(families, query) {
  const matches = matchFonts(families, query);
  fontActionMap = new Map();

  if (matches.length === 0) {
    return [
      { type: 'callout', tone: 'warning', title: 'No Fonts Found', text: 'Try a different font family search.' }
    ];
  }

  let actionIndex = 0;
  const actions = [];
  const listItems = [];
  for (const family of matches) {
    const shownVariants = family.variants.slice(0, MAX_VARIANTS_PER_FAMILY);
    listItems.push(`${family.name}: ${shownVariants.map((variant) => variant.name).join(', ')}`);

    for (const variant of shownVariants) {
      const actionId = `font-${actionIndex}`;
      actionIndex += 1;
      fontActionMap.set(actionId, { family: family.name, variant });
      actions.push({
        id: actionId,
        label: `${family.name} / ${variant.name}`,
        variant: 'outline'
      });
    }
  }

  return [
    {
      type: 'keyValue',
      items: [
        { key: 'Fonts', value: String(families.length) },
        { key: 'Matches', value: String(matches.length) }
      ]
    },
    { type: 'list', items: listItems },
    { type: 'actions', actions }
  ];
}

async function renderPanel(api, context, options = {}) {
  const query = cleanString(options.query ?? '', 80);
  const status = options.status || null;
  const forceRefresh = options.forceRefresh === true;
  const fonts = await loadFonts(api, forceRefresh);
  const hasSelection = context.selectionFrom !== context.selectionTo;
  const blocks = [
    { type: 'heading', text: 'Fonts', level: 3 },
    {
      type: 'badgeList',
      items: [
        {
          label: 'Selection',
          value: hasSelection ? 'Text selected' : 'No text selected',
          tone: hasSelection ? 'success' : 'warning'
        }
      ]
    }
  ];

  if (status) {
    blocks.push(status);
  }

  if (!fonts.granted) {
    blocks.push({
      type: 'callout',
      tone: 'warning',
      title: 'Permission Needed',
      text: 'Grant system:fonts to list installed fonts.'
    }, {
      type: 'actions',
      actions: [{ id: 'refresh-fonts', label: 'Retry Permission', variant: 'primary' }]
    });
    return { blocks };
  }

  blocks.push(
    {
      type: 'input',
      fieldId: 'fontQuery',
      label: 'Font family',
      value: query,
      placeholder: 'Courier, Helvetica, Avenir',
      maxLength: 80
    },
    {
      type: 'actions',
      actions: [
        { id: 'find-fonts', label: 'Find Fonts', variant: 'primary' },
        { id: 'refresh-fonts', label: 'Refresh', variant: 'outline' }
      ]
    },
    ...buildFontResultBlocks(fonts.families, query),
    { type: 'divider' },
    { type: 'heading', text: 'Size', level: 3 },
    {
      type: 'actions',
      actions: COMMON_SIZES.map((size) => ({
        id: `size-${size}`,
        label: `${size} pt`,
        variant: size === 12 ? 'primary' : 'outline'
      }))
    },
    { type: 'divider' },
    { type: 'heading', text: 'Alignment', level: 3 },
    {
      type: 'actions',
      actions: [
        { id: 'align-left', label: 'Left', variant: 'outline' },
        { id: 'align-center', label: 'Center', variant: 'outline' },
        { id: 'align-right', label: 'Right', variant: 'outline' }
      ]
    },
    { type: 'divider' },
    {
      type: 'actions',
      actions: [{ id: 'clear-styles', label: 'Clear Font and Size', variant: 'ghost' }]
    }
  );

  return { blocks };
}

function selectionWarning() {
  return {
    type: 'callout',
    tone: 'warning',
    title: 'Select Text',
    text: 'Font and size actions apply to selected text.'
  };
}

function successStatus(text) {
  return { type: 'callout', tone: 'success', title: 'Applied', text };
}

async function replaceIfChanged(api, context, result, query, successText) {
  if (!result.changed) {
    return {
      content: await renderPanel(api, context, {
        query,
        status: selectionWarning()
      })
    };
  }

  await api.replaceDocument(result.document);
  return {
    content: await renderPanel(api, context, {
      query,
      status: successStatus(successText)
    })
  };
}

export default {
  async setup(api) {
    api.registerUIControl({
      id: 'toggle-font-styles',
      mount: 'bottom-bar',
      kind: 'button',
      label: 'Fonts',
      icon: 'settings',
      priority: 30,
      tooltip: 'Open system font styles panel',
      action: { type: 'panel:toggle', panelId: 'system-font-styles-panel' }
    });

    api.registerUIPanel({
      id: 'system-font-styles-panel',
      title: 'System Font Styles',
      icon: 'settings',
      defaultWidth: 340,
      minWidth: 280,
      maxWidth: 460,
      priority: 30,
      onRender(context) {
        return renderPanel(api, context);
      },
      async onAction(context) {
        const query = cleanString(context.formValues && context.formValues.fontQuery, 80);

        if (context.actionId === 'find-fonts') {
          return { content: await renderPanel(api, context, { query }) };
        }

        if (context.actionId === 'refresh-fonts') {
          cachedFonts = null;
          return { content: await renderPanel(api, context, { query, forceRefresh: true }) };
        }

        if (context.actionId.startsWith('font-')) {
          const font = fontActionMap.get(context.actionId);
          if (!font) {
            return { content: await renderPanel(api, context, { query }) };
          }

          return replaceIfChanged(
            api,
            context,
            applyFontToSelection(context.document, context, font.family, font.variant),
            query,
            `${font.family} / ${font.variant.name}`
          );
        }

        if (context.actionId.startsWith('size-')) {
          const size = normalizeSize(context.actionId.slice('size-'.length));
          return replaceIfChanged(
            api,
            context,
            applySizeToSelection(context.document, context, size),
            query,
            `${size} pt`
          );
        }

        if (context.actionId === 'clear-styles') {
          return replaceIfChanged(
            api,
            context,
            clearStylesInSelection(context.document, context),
            query,
            'Font and size removed'
          );
        }

        if (context.actionId.startsWith('align-')) {
          const alignment = context.actionId.slice('align-'.length);
          const result = applyAlignment(context.document, context, alignment);
          if (result.changed) {
            await api.replaceDocument(result.document);
          }
          return {
            content: await renderPanel(api, context, {
              query,
              status: result.changed
                ? successStatus(`${alignment.charAt(0).toUpperCase()}${alignment.slice(1)} alignment`)
                : { type: 'callout', tone: 'warning', title: 'No Block Changed', text: 'Move the cursor into a text block or select blocks first.' }
            })
          };
        }

        return { action: null };
      }
    });
  }
};
