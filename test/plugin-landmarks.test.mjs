import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import ts from 'typescript';

const compiledExtensionDirectory = mkdtempSync(join(process.cwd(), '.grainery-landmarks-'));
const compiledExtensionPath = join(compiledExtensionDirectory, 'PluginLandmarksExtension.mjs');
const extensionSource = readFileSync(
  new URL('../src/extensions/PluginLandmarksExtension.ts', import.meta.url),
  'utf8'
);
writeFileSync(
  compiledExtensionPath,
  ts.transpileModule(extensionSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
);

after(() => rmSync(compiledExtensionDirectory, { recursive: true, force: true }));

const {
  PluginLandmarksExtension,
  pluginLandmarksPluginKey,
} = await import(pathToFileURL(compiledExtensionPath).href);

const SCENE_COUNT = 121;

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    action: { content: 'text*', group: 'block' },
    sceneHeading: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
});

function createDocument(sceneCount = SCENE_COUNT) {
  return schema.node('doc', null, [
    schema.node('action', null, schema.text('ACTION')),
    ...Array.from({ length: sceneCount }, (_, index) =>
      schema.node('sceneHeading', null, schema.text(`SCENE ${index + 1}`))
    ),
  ]);
}

function createLandmarks(doc) {
  const landmarks = [];
  let sceneIndex = 0;

  doc.descendants((node, position) => {
    if (node.type.name !== 'sceneHeading') {
      return false;
    }

    sceneIndex += 1;
    landmarks.push({
      id: `scene-outline.scene-landmarks.scene-${sceneIndex}`,
      pluginId: 'scene-outline',
      providerId: 'scene-outline.scene-landmarks',
      position,
      from: position,
      to: position + node.nodeSize,
      label: `${sceneIndex} — SCENE ${sceneIndex}`,
      gutterLabel: String(sceneIndex),
      priority: 100,
      ratio: sceneIndex / SCENE_COUNT,
      active: sceneIndex === 1,
    });

    return false;
  });

  return landmarks;
}

function createPlugin() {
  const addPlugins = PluginLandmarksExtension.config.addProseMirrorPlugins;
  assert.equal(typeof addPlugins, 'function');
  const [plugin] = addPlugins.call({});
  return plugin;
}

function createCommands() {
  const addCommands = PluginLandmarksExtension.config.addCommands;
  assert.equal(typeof addCommands, 'function');
  return addCommands.call({});
}

function setLandmarks(state, landmarks) {
  return state.apply(
    state.tr.setMeta(pluginLandmarksPluginKey, {
      type: 'set',
      landmarks,
    })
  );
}

function decorationsFor(plugin, state) {
  const decorations = plugin.props.decorations?.(state);
  assert.ok(decorations, 'landmark plugin should provide decorations');
  return decorations;
}

function widgetTypesByKey(decorations) {
  return new Map(
    decorations
      .find()
      .filter((decoration) => decoration.widget)
      .map((decoration) => [decoration.spec.key, decoration.type])
  );
}

function createScrollableView(state, initialScrollTop = 5_000) {
  const animationFrames = [];
  const container = {
    scrollTop: initialScrollTop,
    scrollTo({ top }) {
      this.scrollTop = top;
    },
  };
  const documentTop = 5_200;
  const view = {
    state,
    dom: {
      ownerDocument: {
        defaultView: {
          requestAnimationFrame(callback) {
            animationFrames.push(callback);
          },
        },
      },
      closest(selector) {
        return selector === '.paginated-editor-container' ? container : null;
      },
    },
    coordsAtPos() {
      return {
        top: documentTop - container.scrollTop,
        bottom: documentTop - container.scrollTop + 20,
        left: 0,
        right: 0,
      };
    },
  };

  return {
    container,
    flushAnimationFrames() {
      for (const callback of animationFrames.splice(0)) {
        callback();
      }
    },
    view,
  };
}

test('maps existing gutter widgets through ordinary document edits', () => {
  const plugin = createPlugin();
  let state = EditorState.create({ doc: createDocument(), plugins: [plugin] });
  state = setLandmarks(state, createLandmarks(state.doc));

  const before = decorationsFor(plugin, state);
  const beforeWidgets = widgetTypesByKey(before);
  assert.equal(before.find().length, SCENE_COUNT * 3);

  state = state.apply(state.tr.insertText('X', 2));

  const after = decorationsFor(plugin, state);
  const afterWidgets = widgetTypesByKey(after);
  assert.equal(after.find().length, SCENE_COUNT * 3);
  assert.equal(afterWidgets.size, SCENE_COUNT * 2);
  for (const [key, type] of beforeWidgets) {
    assert.strictEqual(afterWidgets.get(key), type, `widget ${key} should be retained`);
  }
});

test('reuses gutter decorations when only positions and active state change', () => {
  const plugin = createPlugin();
  let state = EditorState.create({ doc: createDocument(), plugins: [plugin] });
  state = setLandmarks(state, createLandmarks(state.doc));
  state = state.apply(state.tr.insertText('X', 2));

  const before = decorationsFor(plugin, state);
  const refreshed = createLandmarks(state.doc).map((landmark, index) => ({
    ...landmark,
    active: index === 1,
  }));
  state = setLandmarks(state, refreshed);

  assert.strictEqual(decorationsFor(plugin, state), before);
});

test('rebuilds a widget when its visible gutter label changes', () => {
  const plugin = createPlugin();
  let state = EditorState.create({ doc: createDocument(2), plugins: [plugin] });
  const initial = createLandmarks(state.doc);
  state = setLandmarks(state, initial);

  const before = widgetTypesByKey(decorationsFor(plugin, state));
  state = setLandmarks(state, [
    { ...initial[0], gutterLabel: 'A1' },
    initial[1],
  ]);
  const after = widgetTypesByKey(decorationsFor(plugin, state));

  assert.notStrictEqual(
    after.get(`${initial[0].id}:A1:left`),
    before.get(`${initial[0].id}:1:left`)
  );
});

test('does not dispatch a metadata transaction after mapped positions are refreshed', () => {
  const plugin = createPlugin();
  const commands = createCommands();
  let state = EditorState.create({ doc: createDocument(2), plugins: [plugin] });
  const landmarks = createLandmarks(state.doc);
  state = setLandmarks(state, landmarks);
  state = state.apply(state.tr.insertText('X', 2));
  const refreshed = createLandmarks(state.doc).map((landmark, index) => ({
    ...landmark,
    active: index === 1,
  }));

  let dispatched = null;
  const handled = commands.setPluginLandmarks(refreshed)({
    state,
    tr: state.tr,
    dispatch: (transaction) => {
      dispatched = transaction;
    },
  });

  assert.equal(handled, true);
  assert.equal(dispatched, null);
});

test('keeps necessary gutter metadata updates out of undo history', () => {
  const plugin = createPlugin();
  const commands = createCommands();
  let state = EditorState.create({ doc: createDocument(2), plugins: [plugin] });
  const landmarks = createLandmarks(state.doc);
  state = setLandmarks(state, landmarks);

  let dispatched = null;
  commands.setPluginLandmarks([
    { ...landmarks[0], gutterLabel: 'A1' },
    landmarks[1],
  ])({
    state,
    tr: state.tr,
    dispatch: (transaction) => {
      dispatched = transaction;
    },
  });

  assert.ok(dispatched);
  assert.equal(dispatched.getMeta('addToHistory'), false);
});

test('rebuilds when a provider moves an unchanged label without a document edit', () => {
  const plugin = createPlugin();
  let state = EditorState.create({ doc: createDocument(2), plugins: [plugin] });
  const initial = createLandmarks(state.doc);
  state = setLandmarks(state, initial);
  const before = decorationsFor(plugin, state);

  state = setLandmarks(state, [
    { ...initial[0], from: initial[1].from, to: initial[1].to },
    initial[1],
  ]);

  assert.notStrictEqual(decorationsFor(plugin, state), before);
});

test('rebuilds the correct gutter set after a scene is deleted', () => {
  const plugin = createPlugin();
  let state = EditorState.create({ doc: createDocument(), plugins: [plugin] });
  const initial = createLandmarks(state.doc);
  state = setLandmarks(state, initial);

  state = state.apply(state.tr.delete(initial[0].from, initial[0].to));
  state = setLandmarks(state, createLandmarks(state.doc));

  assert.equal(decorationsFor(plugin, state).find().length, (SCENE_COUNT - 1) * 3);
});

test('preserves the viewport when deleting a decorated scene heading', () => {
  const plugin = createPlugin();
  let state = EditorState.create({ doc: createDocument(), plugins: [plugin] });
  const initial = createLandmarks(state.doc);
  state = setLandmarks(state, initial);
  const scene = initial[80];
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, scene.from + 1))
  );

  const { container, flushAnimationFrames, view } = createScrollableView(state);
  const pluginView = plugin.spec.view(view);
  const previousState = state;
  state = state.apply(state.tr.delete(scene.from, scene.to));
  view.state = state;
  container.scrollTop = 0;

  pluginView.update(view, previousState);

  assert.equal(container.scrollTop, 5_000);
  container.scrollTop = 0;
  flushAnimationFrames();
  assert.equal(container.scrollTop, 5_000);
  assert.equal(pluginLandmarksPluginKey.getState(state).needsRebuild, true);
  pluginView.destroy();
});

test('preserves the viewport while rebuilding provider landmarks', () => {
  const plugin = createPlugin();
  const commands = createCommands();
  let state = EditorState.create({ doc: createDocument(2), plugins: [plugin] });
  const initial = createLandmarks(state.doc);
  state = setLandmarks(state, initial);

  const { container, flushAnimationFrames, view } = createScrollableView(state);
  const pluginView = plugin.spec.view(view);
  const previousState = state;
  commands.setPluginLandmarks([
    { ...initial[0], gutterLabel: 'A1' },
    initial[1],
  ])({
    state,
    tr: state.tr,
    dispatch: (transaction) => {
      state = state.apply(transaction);
      view.state = state;
      container.scrollTop = 0;
    },
  });
  pluginView.update(view, previousState);

  assert.equal(container.scrollTop, 5_000);
  container.scrollTop = 0;
  flushAnimationFrames();
  assert.equal(container.scrollTop, 5_000);
  pluginView.destroy();
});

test('does not require an editor view while setting provider landmarks', () => {
  const plugin = createPlugin();
  const commands = createCommands();
  let state = EditorState.create({ doc: createDocument(2), plugins: [plugin] });

  assert.doesNotThrow(() => {
    commands.setPluginLandmarks(createLandmarks(state.doc))({
      state,
      tr: state.tr,
      dispatch: (transaction) => {
        state = state.apply(transaction);
      },
    });
  });
});
