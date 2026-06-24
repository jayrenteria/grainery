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

let cachedFonts = null;
let fontPermissionDenied = false;
let familyActionMap = new Map();
let variantActionMap = new Map();
let lastQuery = '';
let selectedFamilyKey = null;
let lastAppliedFontKey = null;
let lastAppliedSize = null;
let lastAppliedAlignment = null;

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

function fontVariantKey(family, variant) {
  const familyName = normalizeFontName(family).toLowerCase();
  const weight = normalizeFontWeight(variant && variant.weight) || '';
  const style = normalizeFontStyle(variant && variant.style) || 'normal';
  return `${familyName}:${weight}:${style}`;
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
  let position = 0;
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

function clearAlignment(document, context) {
  const next = cloneJson(document);
  const blocks = Array.isArray(next.content) ? next.content : [];
  const range = selectionRange(context);
  let position = 0;
  let changed = false;

  for (const block of blocks) {
    const size = Math.max(getNodeSize(block), 1);
    const blockFrom = position;
    const blockTo = position + size;
    const matches = range.empty
      ? range.from >= blockFrom && range.from <= blockTo
      : blockFrom < range.to && blockTo > range.from;

    if (matches && block.attrs && Object.prototype.hasOwnProperty.call(block.attrs, 'textAlign')) {
      const attrs = { ...block.attrs };
      delete attrs.textAlign;
      block.attrs = Object.keys(attrs).length > 0 ? attrs : undefined;
      changed = true;
    }

    position += size;
  }

  return { changed, document: next };
}

function clearStylesAndAlignment(document, context) {
  const styleResult = clearStylesInSelection(document, context);
  const alignmentResult = clearAlignment(styleResult.document, context);
  return {
    changed: styleResult.changed || alignmentResult.changed,
    document: alignmentResult.document
  };
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
  let position = 0;
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
  if (!normalized) {
    return families;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return families.filter((family) => {
    const searchable = [
      family.name,
      ...family.variants.map((variant) => variant.name)
    ].join(' ').toLowerCase();

    return tokens.every((token) => searchable.includes(token));
  });
}

function fontFamilyKey(family) {
  return family.name.toLowerCase();
}

function findFamilyByKey(families, key) {
  if (!key) {
    return null;
  }

  return families.find((family) => fontFamilyKey(family) === key) || null;
}

function styleValueState() {
  return { value: null, mixed: false, sawText: false };
}

function addStyleValue(state, value) {
  state.sawText = true;
  if (value === null || value === undefined || value === '') {
    state.mixed = true;
    return;
  }
  if (state.value === null) {
    state.value = value;
    return;
  }
  if (state.value !== value) {
    state.mixed = true;
  }
}

function textNodeOverlapsSelection(text, textPos, range) {
  if (range.empty) {
    return range.from >= textPos && range.from <= textPos + text.length;
  }

  return textPos < range.to && textPos + text.length > range.from;
}

function collectTextStyleValues(node, startPos, range, fontState, sizeState) {
  if (!node) {
    return;
  }

  if (typeof node.text === 'string') {
    if (!textNodeOverlapsSelection(node.text, startPos, range)) {
      return;
    }

    const marks = normalizeMarks(node.marks);
    const fontMark = marks.find((mark) => mark.type === 'fontFamily');
    const sizeMark = marks.find((mark) => mark.type === 'textSize');
    if (fontMark && typeof fontMark.attrs?.fontFamily === 'string') {
      addStyleValue(fontState, fontVariantKey(fontMark.attrs.fontFamily, {
        weight: fontMark.attrs.fontWeight,
        style: fontMark.attrs.fontStyle
      }));
    } else {
      addStyleValue(fontState, null);
    }

    const size = sizeMark ? normalizeSize(sizeMark.attrs?.sizePt) : null;
    addStyleValue(sizeState, size);
    return;
  }

  let childPos = startPos + 1;
  for (const child of Array.isArray(node.content) ? node.content : []) {
    collectTextStyleValues(child, childPos, range, fontState, sizeState);
    childPos += getNodeSize(child);
  }
}

function collectSelectionStyles(document, context) {
  const range = selectionRange(context);
  const fontState = styleValueState();
  const sizeState = styleValueState();
  const alignmentState = styleValueState();
  const blocks = Array.isArray(document && document.content) ? document.content : [];
  let position = 0;

  for (const block of blocks) {
    const size = Math.max(getNodeSize(block), 1);
    const blockFrom = position;
    const blockTo = position + size;
    const matches = range.empty
      ? range.from >= blockFrom && range.from <= blockTo
      : blockFrom < range.to && blockTo > range.from;

    if (matches) {
      collectTextStyleValues(block, position, range, fontState, sizeState);
      if (ALIGNABLE_NODE_TYPES.has(block.type)) {
        const alignment = block.attrs && typeof block.attrs.textAlign === 'string'
          ? block.attrs.textAlign
          : 'left';
        addStyleValue(alignmentState, alignment);
      }
    }

    position += size;
  }

  const fontVariant = fontState.sawText && !fontState.mixed ? fontState.value : null;
  return {
    hasText: fontState.sawText || sizeState.sawText,
    hasAlignmentBlock: alignmentState.sawText,
    fontVariant,
    fontFamilyKey: fontVariant ? fontVariant.split(':')[0] : null,
    sizePt: sizeState.sawText && !sizeState.mixed ? sizeState.value : null,
    alignment: alignmentState.sawText && !alignmentState.mixed ? alignmentState.value : null
  };
}

function setLastQuery(query) {
  const nextQuery = cleanString(query, 80);
  if (nextQuery !== lastQuery) {
    lastQuery = nextQuery;
    selectedFamilyKey = null;
  }
}

function selectionRange(context) {
  const from = Number.isFinite(context.selectionFrom) ? context.selectionFrom : 0;
  const to = Number.isFinite(context.selectionTo) ? context.selectionTo : from;
  return {
    from: Math.min(from, to),
    to: Math.max(from, to),
    empty: from === to
  };
}

function fontPreview(family, variant = null) {
  const preview = {
    fontFamily: family
  };
  const weight = normalizeFontWeight(variant && variant.weight);
  const style = normalizeFontStyle(variant && variant.style);
  if (weight) {
    preview.fontWeight = weight;
  }
  if (style) {
    preview.fontStyle = style;
  }
  return preview;
}

function buildFontResultBlocks(families, query, selectionStyles) {
  const matches = matchFonts(families, query);
  familyActionMap = new Map();
  variantActionMap = new Map();

  if (matches.length === 0) {
    return [
      {
        type: 'keyValue',
        items: [
          { key: 'Fonts', value: String(families.length) },
          { key: 'Matches', value: '0' }
        ]
      },
      { type: 'callout', tone: 'warning', title: 'No Fonts Found', text: 'Try a different font family search.' }
    ];
  }

  const selectedFamilyKeyForPanel = selectedFamilyKey || selectionStyles.fontFamilyKey;
  const activeFontKey = selectionStyles.hasText
    ? selectionStyles.fontVariant
    : lastAppliedFontKey;
  const selectedFamily = findFamilyByKey(matches, selectedFamilyKeyForPanel)
    || (matches.length === 1 ? matches[0] : null);
  const selectedKey = selectedFamily ? fontFamilyKey(selectedFamily) : null;

  const familyActions = matches.map((family, index) => {
    const actionId = `family-${index}`;
    const key = fontFamilyKey(family);
    familyActionMap.set(actionId, key);
    return {
      id: actionId,
      label: family.name,
      preview: fontPreview(family.name),
      variant: key === selectedKey ? 'primary' : 'outline'
    };
  });

  const blocks = [
    {
      type: 'keyValue',
      items: [
        { key: 'Fonts', value: String(families.length) },
        { key: 'Matches', value: String(matches.length) }
      ]
    },
    {
      type: 'scroll',
      maxHeight: 390,
      blocks: [
        {
          type: 'actions',
          actions: familyActions
        }
      ]
    }
  ];

  if (!selectedFamily) {
    blocks.push({
      type: 'text',
      text: 'Select a font family to show its variants.'
    });
    return blocks;
  }

  blocks.push(
    { type: 'heading', text: selectedFamily.name, level: 4 },
    {
      type: 'actions',
      actions: selectedFamily.variants.map((variant, index) => {
        const actionId = `variant-${index}`;
        const variantKey = fontVariantKey(selectedFamily.name, variant);
        variantActionMap.set(actionId, { family: selectedFamily.name, variant, variantKey });
        return {
          id: actionId,
          label: variant.name,
          preview: fontPreview(selectedFamily.name, variant),
          variant: variantKey === activeFontKey ? 'primary' : 'outline'
        };
      })
    }
  );

  return blocks;
}

async function renderPanel(api, context, options = {}) {
  const query = cleanString(options.query ?? context.formValues?.fontQuery ?? lastQuery, 80);
  setLastQuery(query);
  const status = options.status || null;
  const forceRefresh = options.forceRefresh === true;
  const fonts = await loadFonts(api, forceRefresh);
  const selectionStyles = collectSelectionStyles(context.document, context);
  const activeSize = selectionStyles.hasText ? selectionStyles.sizePt : lastAppliedSize;
  const activeAlignment = selectionStyles.hasAlignmentBlock
    ? selectionStyles.alignment
    : lastAppliedAlignment;
  const hasSelection = context.selectionFrom !== context.selectionTo;
  const blocks = [
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
      label: 'Find Fonts',
      value: query,
      placeholder: 'Courier, Helvetica, Avenir',
      maxLength: 80
    },
    { type: 'divider' },
    ...buildFontResultBlocks(fonts.families, query, selectionStyles),
    { type: 'divider' },
    { type: 'heading', text: 'Size', level: 3 },
    {
      type: 'actions',
      actions: COMMON_SIZES.map((size) => ({
        id: `size-${size}`,
        label: `${size} pt`,
        variant: size === activeSize ? 'primary' : 'outline'
      }))
    },
    { type: 'divider' },
    { type: 'heading', text: 'Alignment', level: 3 },
    {
      type: 'actions',
      actions: [
        { id: 'align-left', label: 'Left', variant: activeAlignment === 'left' ? 'primary' : 'outline' },
        { id: 'align-center', label: 'Center', variant: activeAlignment === 'center' ? 'primary' : 'outline' },
        { id: 'align-right', label: 'Right', variant: activeAlignment === 'right' ? 'primary' : 'outline' }
      ]
    },
    { type: 'divider' },
    {
      type: 'actions',
      actions: [{ id: 'clear-styles', label: 'CLEAR STYLES', variant: 'outline' }]
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

        if (context.actionId === 'refresh-fonts') {
          setLastQuery(query);
          cachedFonts = null;
          return { content: await renderPanel(api, context, { query, forceRefresh: true }) };
        }

        if (context.actionId.startsWith('family-')) {
          setLastQuery(query);
          selectedFamilyKey = familyActionMap.get(context.actionId) || selectedFamilyKey;
          return { content: await renderPanel(api, context, { query }) };
        }

        if (context.actionId.startsWith('variant-')) {
          setLastQuery(query);
          const font = variantActionMap.get(context.actionId);
          if (!font) {
            return { content: await renderPanel(api, context, { query }) };
          }

          lastAppliedFontKey = font.variantKey;
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
          lastAppliedSize = size;
          return replaceIfChanged(
            api,
            context,
            applySizeToSelection(context.document, context, size),
            query,
            `${size} pt`
          );
        }

        if (context.actionId === 'clear-styles') {
          lastAppliedFontKey = null;
          lastAppliedSize = null;
          lastAppliedAlignment = null;
          return replaceIfChanged(
            api,
            context,
            clearStylesAndAlignment(context.document, context),
            query,
            'Styles cleared'
          );
        }

        if (context.actionId.startsWith('align-')) {
          const alignment = context.actionId.slice('align-'.length);
          const result = applyAlignment(context.document, context, alignment);
          if (result.changed) {
            lastAppliedAlignment = alignment;
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
