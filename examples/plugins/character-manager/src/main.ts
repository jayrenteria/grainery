import type {
  EditorCompletionContext,
  GraineryPlugin,
  PluginApi,
  ScreenplayBlock,
  ScreenplayDocument,
  UIPanelContent,
  UIPanelStateContext,
} from '@grainery/plugin-sdk';

const PANEL_ID = 'character-manager-panel';
const MAX_PANEL_CHARACTERS = 200;
const MAX_ACTIONS_PER_BLOCK = 64;

interface CharacterRecord {
  name: string;
  count: number;
  firstIndex: number;
}

interface RenamePreview {
  source: string;
  target: string;
  sourceCount: number;
  targetCount: number;
}

interface CharacterManagerState {
  documentId: string | null;
  selectedSource: string | null;
  preview: RenamePreview | null;
  successMessage: string | null;
}

const managerState: CharacterManagerState = {
  documentId: null,
  selectedSource: null,
  preview: null,
  successMessage: null,
};

function syncDocumentState(context: Pick<UIPanelStateContext, 'metadata'>): void {
  const documentId = typeof context.metadata?.documentId === 'string'
    ? context.metadata.documentId
    : null;

  if (documentId === managerState.documentId) {
    return;
  }

  managerState.documentId = documentId;
  managerState.selectedSource = null;
  managerState.preview = null;
  managerState.successMessage = null;
}

function normalizeCharacterName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleUpperCase('en-US');
}

function screenplayFrom(
  api: PluginApi,
  context: {
    document: EditorCompletionContext['document'];
    screenplay?: ScreenplayDocument;
    selectionFrom?: number;
    selectionTo?: number;
  }
): ScreenplayDocument {
  return context.screenplay || api.screenplay.from(context.document, {
    selectionFrom: context.selectionFrom,
    selectionTo: context.selectionTo,
  });
}

function characterIndex(
  screenplay: ScreenplayDocument,
  excludeBlockIndex: number | null = null
): CharacterRecord[] {
  const records = new Map<string, CharacterRecord>();

  for (const block of screenplay.characters()) {
    if (block.index === excludeBlockIndex) {
      continue;
    }

    const name = normalizeCharacterName(block.text);
    if (!name) {
      continue;
    }

    const existing = records.get(name);
    if (existing) {
      existing.count += 1;
    } else {
      records.set(name, { name, count: 1, firstIndex: block.index });
    }
  }

  return [...records.values()].sort(
    (a, b) => a.firstIndex - b.firstIndex || a.name.localeCompare(b.name)
  );
}

function targetFieldId(characters: CharacterRecord[]): string {
  const index = managerState.selectedSource
    ? characters.findIndex((character) => character.name === managerState.selectedSource)
    : -1;
  return `rename-target-${Math.max(0, index)}`;
}

function getTargetName(context: UIPanelStateContext, characters: CharacterRecord[]): string {
  return normalizeCharacterName(context.formValues?.[targetFieldId(characters)] ?? '');
}

function chunkItems<T>(items: readonly T[], size = MAX_ACTIONS_PER_BLOCK): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildPanel(api: PluginApi, context: UIPanelStateContext): UIPanelContent {
  syncDocumentState(context);
  const characters = characterIndex(screenplayFrom(api, context)).slice(0, MAX_PANEL_CHARACTERS);
  if (
    managerState.selectedSource
    && !characters.some((character) => character.name === managerState.selectedSource)
  ) {
    managerState.selectedSource = null;
    managerState.preview = null;
  }

  const target = getTargetName(context, characters);
  if (managerState.preview && target && managerState.preview.target !== target) {
    managerState.preview = null;
  }

  const blocks: UIPanelContent['blocks'] = [
    {
      type: 'text',
      text: 'Autocomplete uses existing character cues only. Select a character below to rename every matching cue.',
    },
    {
      type: 'keyValue',
      items: [
        { key: 'Characters', value: String(characters.length) },
        { key: 'Selected', value: managerState.selectedSource ?? '—' },
      ],
    },
  ];

  if (managerState.successMessage) {
    blocks.push({
      type: 'callout',
      tone: 'success',
      title: 'Rename complete',
      text: managerState.successMessage,
    });
  }

  if (characters.length === 0) {
    blocks.push({ type: 'text', text: 'No character cues found yet.' });
    return { blocks };
  }

  const characterActionBlocks = chunkItems(characters).map((chunk) => ({
    type: 'actions' as const,
    layout: 'stack' as const,
    actions: chunk.map((character) => ({
      id: `source-${characters.indexOf(character)}`,
      label: `${character.name} · ${character.count}`,
      variant: character.name === managerState.selectedSource ? 'primary' as const : 'outline' as const,
      fullWidth: true,
    })),
  }));

  blocks.push({
    type: 'scroll',
    maxHeight: managerState.selectedSource ? 240 : 440,
    scrollToActionId: managerState.selectedSource
      ? `source-${characters.findIndex((character) => character.name === managerState.selectedSource)}`
      : undefined,
    blocks: characterActionBlocks,
  });

  if (!managerState.selectedSource) {
    return { blocks };
  }

  const sourceRecord = characters.find(
    (character) => character.name === managerState.selectedSource
  );
  blocks.push(
    { type: 'divider' },
    {
      type: 'input',
      fieldId: targetFieldId(characters),
      label: `Rename ${managerState.selectedSource} to`,
      placeholder: 'NEW CHARACTER NAME',
      maxLength: 100,
    }
  );

  if (managerState.preview && sourceRecord) {
    const mergeText = managerState.preview.targetCount > 0
      ? ` ${managerState.preview.targetCount} existing ${managerState.preview.target} cues will be merged with them.`
      : '';
    blocks.push({
      type: 'callout',
      tone: managerState.preview.targetCount > 0 ? 'warning' : 'info',
      title: 'Confirm mass rename',
      text: `${managerState.preview.sourceCount} ${managerState.preview.source} cues will become ${managerState.preview.target}.${mergeText} Character extensions and text styling will be preserved.`,
    });
    blocks.push({
      type: 'actions',
      actions: [
        { id: 'confirm-rename', label: 'Rename cues', variant: 'primary' },
        { id: 'cancel-rename', label: 'Cancel', variant: 'ghost' },
      ],
    });
  } else {
    blocks.push({
      type: 'actions',
      actions: [{ id: 'preview-rename', label: 'Preview rename', variant: 'primary' }],
    });
  }

  return { blocks };
}

function matchingCharacterBlocks(document: ScreenplayDocument, source: string): ScreenplayBlock[] {
  return document.characters().filter(
    (block) => normalizeCharacterName(block.text) === source
  );
}

const plugin: GraineryPlugin = {
  setup(api) {
    api.registerEditorCompletionProvider({
      id: 'existing-characters',
      title: 'Existing characters',
      priority: 100,
      handler(context) {
        if (
          context.documentMode !== 'screenplay'
          || context.currentElementType !== 'character'
          || !context.cursorAtBlockEnd
        ) {
          return [];
        }

        const query = normalizeCharacterName(context.query);
        if (query.length < 1) {
          return [];
        }

        return characterIndex(screenplayFrom(api, context), context.currentBlockIndex)
          .filter((character) => character.name.startsWith(query) && character.name !== query)
          .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex || a.name.localeCompare(b.name))
          .slice(0, 8)
          .map((character, index) => ({
            id: `character-${index}`,
            label: character.name,
            insertText: character.name,
            detail: `${character.count} cue${character.count === 1 ? '' : 's'}`,
          }));
      },
    });

    api.registerInlineAnnotationProvider({
      id: 'selected-character-cues',
      title: 'Selected Character Cues',
      priority: 20,
      handler(context) {
        syncDocumentState(context);
        if (!managerState.selectedSource) {
          return [];
        }

        return matchingCharacterBlocks(
          screenplayFrom(api, context),
          managerState.selectedSource
        ).map((block) => ({
          id: `selected-character-${block.index}`,
          from: block.from,
          to: block.from + block.text.length,
          kind: 'note-active',
        }));
      },
    });

    api.registerUIControl({
      id: 'toggle-character-manager',
      mount: 'bottom-bar',
      kind: 'button',
      label: 'Characters',
      icon: 'character',
      priority: 15,
      tooltip: 'Open Character Manager',
      action: { type: 'panel:toggle', panelId: PANEL_ID },
    });

    api.registerUIPanel({
      id: PANEL_ID,
      title: 'Character Manager',
      icon: 'character',
      defaultWidth: 360,
      minWidth: 300,
      maxWidth: 460,
      priority: 15,
      onRender(context) {
        return buildPanel(api, context);
      },
      async onAction(context) {
        syncDocumentState(context);
        const characters = characterIndex(screenplayFrom(api, context)).slice(0, MAX_PANEL_CHARACTERS);
        const sourceMatch = /^source-(\d+)$/.exec(context.actionId);
        if (sourceMatch) {
          const sourceIndex = Number.parseInt(sourceMatch[1], 10);
          managerState.selectedSource = characters[sourceIndex]?.name ?? null;
          managerState.preview = null;
          managerState.successMessage = null;
          return { content: buildPanel(api, { ...context, formValues: {} }) };
        }

        if (context.actionId === 'cancel-rename') {
          managerState.preview = null;
          return { content: buildPanel(api, context) };
        }

        if (!managerState.selectedSource) {
          return { content: buildPanel(api, context) };
        }

        const target = normalizeCharacterName(context.formValues[targetFieldId(characters)] ?? '');
        const sourceRecord = characters.find(
          (character) => character.name === managerState.selectedSource
        );
        if (!target || target === managerState.selectedSource || !sourceRecord) {
          managerState.preview = null;
          return {
            content: {
              blocks: [
                { type: 'callout', tone: 'warning', text: 'Enter a different character name before previewing the rename.' },
                ...buildPanel(api, context).blocks,
              ],
            },
          };
        }

        if (context.actionId === 'preview-rename') {
          managerState.preview = {
            source: managerState.selectedSource,
            target,
            sourceCount: sourceRecord.count,
            targetCount: characters.find((character) => character.name === target)?.count ?? 0,
          };
          managerState.successMessage = null;
          return { content: buildPanel(api, context) };
        }

        if (
          context.actionId === 'confirm-rename'
          && managerState.preview?.source === managerState.selectedSource
          && managerState.preview.target === target
        ) {
          const source = managerState.selectedSource;
          let renamedCount = 0;
          await api.screenplay.mutate((document) => {
            const matches = matchingCharacterBlocks(document, source);
            renamedCount = matches.length;
            for (const block of matches) {
              document.setBlockText(block.index, target);
            }
          });

          managerState.selectedSource = target;
          managerState.preview = null;
          managerState.successMessage = `Renamed ${renamedCount} cue${renamedCount === 1 ? '' : 's'} from ${source} to ${target}.`;
          return { action: null };
        }

        return { content: buildPanel(api, context) };
      },
    });
  },
};

export default plugin;
