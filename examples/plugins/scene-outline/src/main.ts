import type {
  DocumentTransformContext,
  EditorLandmarkContext,
  GraineryPlugin,
  PluginApi,
  ScreenplayDocument,
  UIPanelContent,
  UIPanelStateContext,
} from '@grainery/plugin-sdk';

const PANEL_ID = 'scene-outline-panel';
const MAX_ACTIONS_PER_BLOCK = 64;

interface IndexedScene {
  id: string;
  number: number;
  label: string;
  actionId: string;
  position: number;
  nodeFrom: number;
  nodeTo: number;
  active: boolean;
}

function chunkItems<T>(items: readonly T[], size = MAX_ACTIONS_PER_BLOCK): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function screenplayFrom(
  api: PluginApi,
  context: {
    document: EditorLandmarkContext['document'];
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

function normalizeHeading(raw: string, sceneNumber: number): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.toUpperCase() : `SCENE ${sceneNumber}`;
}

function buildSceneIndex(
  screenplay: ScreenplayDocument,
  selectionFrom: number
): IndexedScene[] {
  const scenes = screenplay.scenes();
  let activeSceneIndex = -1;
  if (Number.isFinite(selectionFrom)) {
    for (let index = scenes.length - 1; index >= 0; index -= 1) {
      if (selectionFrom >= scenes[index].from) {
        activeSceneIndex = index;
        break;
      }
    }
  }

  return scenes.map((scene, index) => ({
    id: scene.id,
    number: scene.number,
    label: normalizeHeading(scene.heading.text, scene.number),
    actionId: `scene-${scene.number}`,
    position: scene.from,
    nodeFrom: Math.max(0, scene.heading.from - 1),
    nodeTo: Math.max(1, scene.heading.to - 1),
    active: index === activeSceneIndex,
  }));
}

function buildPanel(api: PluginApi, context: UIPanelStateContext): UIPanelContent {
  const scenes = buildSceneIndex(screenplayFrom(api, context), context.selectionFrom);
  const activeScene = scenes.find((scene) => scene.active);

  if (scenes.length === 0) {
    return {
      blocks: [{ type: 'text', text: 'No scene headings found yet.' }],
    };
  }

  return {
    blocks: [
      { type: 'text', text: 'Scenes are numbered automatically. Select one to jump to it.' },
      {
        type: 'keyValue',
        items: [
          { key: 'Scenes', value: String(scenes.length) },
          { key: 'Current', value: activeScene ? String(activeScene.number) : '—' },
        ],
      },
      {
        type: 'scroll',
        maxHeight: 460,
        scrollToActionId: activeScene?.actionId,
        blocks: chunkItems(scenes).map((chunk) => ({
          type: 'actions',
          layout: 'stack',
          actions: chunk.map((scene) => ({
            id: scene.actionId,
            label: `${scene.number}. ${scene.label}`,
            variant: scene.active ? 'primary' : 'outline',
            fullWidth: true,
          })),
        })),
      },
    ],
  };
}

function renumberScenes(api: PluginApi, context: DocumentTransformContext) {
  const screenplay = screenplayFrom(api, context);
  let changed = false;

  for (const scene of screenplay.scenes()) {
    if (scene.heading.attrs?.sceneNumber !== scene.number) {
      screenplay.updateBlockAttrs(scene.heading.index, { sceneNumber: scene.number });
      changed = true;
    }
  }

  return changed ? screenplay.toJSON() : undefined;
}

const plugin: GraineryPlugin = {
  setup(api) {
    api.registerEditorLandmarkProvider({
      id: 'scene-landmarks',
      title: 'Scene map and numbers',
      priority: 100,
      handler(context) {
        if (context.documentMode !== 'screenplay') {
          return [];
        }

        return buildSceneIndex(screenplayFrom(api, context), context.selectionFrom).map((scene) => ({
          id: scene.id,
          position: scene.position,
          from: scene.nodeFrom,
          to: scene.nodeTo,
          label: `${scene.number} — ${scene.label}`,
          shortLabel: String(scene.number),
          gutterLabel: String(scene.number),
          active: scene.active,
        }));
      },
    });

    api.registerUIControl({
      id: 'toggle-scene-outline',
      mount: 'bottom-bar',
      kind: 'button',
      label: 'Scenes',
      icon: 'scene-heading',
      priority: 5,
      tooltip: 'Open Scene Manager',
      action: { type: 'panel:toggle', panelId: PANEL_ID },
    });

    api.registerUIPanel({
      id: PANEL_ID,
      title: 'Scene Manager',
      icon: 'scene-heading',
      defaultWidth: 340,
      minWidth: 280,
      maxWidth: 440,
      priority: 5,
      onRender(context) {
        return buildPanel(api, context);
      },
      onAction(context) {
        const match = /^scene-(\d+)$/.exec(context.actionId);
        const sceneNumber = match ? Number.parseInt(match[1], 10) : NaN;
        const scene = buildSceneIndex(screenplayFrom(api, context), context.selectionFrom)
          .find((candidate) => candidate.number === sceneNumber);

        return {
          action: scene
            ? { type: 'editor:jump-to', position: scene.position, offsetTop: 100 }
            : null,
        };
      },
    });

    for (const hook of ['post-open', 'pre-save', 'pre-export'] as const) {
      api.registerDocumentTransform({
        id: `renumber-scenes-${hook}`,
        hook,
        priority: 100,
        handler(context) {
          return renumberScenes(api, context);
        },
      });
    }
  },
};

export default plugin;
