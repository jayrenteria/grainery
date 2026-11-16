import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/saveFlow.ts', import.meta.url), 'utf8');
const { SaveFlow } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText).toString('base64')}`);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('saves run in request order and capture the latest revision when started', async () => {
  const flow = new SaveFlow();
  const gate = deferred();
  const events = [];
  const first = flow.enqueue(async () => {
    events.push('first');
    const snapshot = flow.snapshot('doc');
    await gate.promise;
    assert.equal(flow.isCurrent(snapshot, 'doc'), false, 'pending-save edits remain dirty');
  });
  const second = flow.enqueue(async () => {
    events.push('second');
    assert.equal(flow.isCurrent(flow.snapshot('doc'), 'doc'), true);
  });
  await Promise.resolve();
  assert.deepEqual(events, ['first']);
  flow.changed();
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first', 'second']);
});

test('document switching and title-page/plugin-data revisions invalidate completion', () => {
  const flow = new SaveFlow();
  const snapshot = flow.snapshot('old');
  assert.equal(flow.isCurrent(snapshot, 'new'), false);
  flow.opened();
  assert.equal(flow.isSameDocument(snapshot, 'old'), false, 'reopening a copied document with the same ID is a new session');
  const reopened = flow.snapshot('old');
  assert.equal(flow.isSameDocument(reopened, 'old'), true);
  flow.changed();
  assert.equal(flow.isSameDocument(reopened, 'old'), true, 'edits retain Save As path ownership');
  assert.equal(flow.isCurrent(reopened, 'old'), false);
  assert.equal(flow.isCurrent(snapshot, 'old'), false);
});

test('a failed or cancelled save does not poison subsequent saves', async () => {
  const flow = new SaveFlow();
  await assert.rejects(flow.enqueue(async () => { throw new Error('disk full'); }), /disk full/);
  assert.equal(await flow.enqueue(async () => null), null, 'Save As cancelled');
  assert.equal(await flow.enqueue(async () => 'saved'), 'saved');
});

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const handlerStart = appSource.indexOf('  const persistCurrentDocument = useCallback(');
const handlerEnd = appSource.indexOf('  const performAutoSave =', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const handlerCode = ts.transpileModule(
  appSource.slice(handlerStart, handlerEnd).replace('const persistCurrentDocument =', 'export const persistCurrentDocument ='),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;

function saveHarness(persist) {
  const state = {
    documentRef: { current: { meta: { id: 'doc', filename: 'old.gwx', filePath: '/old.gwx' }, document: { text: 'old' } } },
    editorContentRef: { current: { text: 'old' } },
    isDirtyRef: { current: true },
    saveFlowRef: { current: new SaveFlow() },
    dialogs: [],
    queued: 0,
  };
  const bindings = {
    ...state,
    useCallback: (callback) => callback,
    runTransformHook: async (_hook, content) => content,
    clearQueuedAutoSave: () => {},
    queueAutoSave: () => { state.queued += 1; },
    setDocument: (next) => { state.documentRef.current = next; },
    setIsDirty: (dirty) => { state.dirty = dirty; },
    refreshRecentFiles: () => {},
    updateWindowTitle: async () => {},
    saveFile: (doc, content) => persist(doc, content, false),
    saveFileAs: (doc, content) => persist(doc, content, true),
    messageDialog: async (message) => { state.dialogs.push(message); },
    getErrorMessage: (error) => error.message,
    console: { error: () => {} },
  };
  const exports = {};
  new Function('exports', ...Object.keys(bindings), handlerCode)(exports, ...Object.values(bindings));
  state.save = exports.persistCurrentDocument;
  state.edit = (content) => {
    state.editorContentRef.current = content;
    state.saveFlowRef.current.changed();
    state.isDirtyRef.current = true;
  };
  return state;
}

function saved(doc, content, saveAs = false) {
  return { ...doc, document: content, meta: { ...doc.meta, ...(saveAs ? { filename: 'new.gwx', filePath: '/new.gwx' } : {}) } };
}

test('actual save handler preserves pending edits and adopts the Save As path', async () => {
  const gate = deferred();
  const started = deferred();
  const state = saveHarness(async (doc, content, saveAs) => {
    started.resolve(); await gate.promise; return saved(doc, content, saveAs);
  });
  const pending = state.save(true);
  await started.promise;
  state.edit({ text: 'new edit' });
  state.documentRef.current = { ...state.documentRef.current, titlePage: { title: 'new title' }, pluginData: { test: 'new data' } };
  state.saveFlowRef.current.changed();
  gate.resolve();
  assert.equal(await pending, false, 'save-before-close must not discard intervening edits');
  assert.deepEqual(state.editorContentRef.current, { text: 'new edit' });
  assert.deepEqual(state.documentRef.current.titlePage, { title: 'new title' });
  assert.deepEqual(state.documentRef.current.pluginData, { test: 'new data' });
  assert.equal(state.documentRef.current.meta.filePath, '/new.gwx');
  assert.equal(state.isDirtyRef.current, true);
  assert.equal(state.queued, 1);
});

test('actual overlapping saves persist newer content last', async () => {
  const gate = deferred();
  const started = deferred();
  const writes = [];
  const state = saveHarness(async (doc, content, saveAs) => {
    writes.push(content.text);
    if (writes.length === 1) { started.resolve(); await gate.promise; }
    return saved(doc, content, saveAs);
  });
  const first = state.save();
  await started.promise;
  state.edit({ text: 'newer' });
  const second = state.save(true);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.deepEqual(writes, ['old', 'newer']);
  assert.equal(state.documentRef.current.meta.filePath, '/new.gwx');
  assert.equal(state.isDirtyRef.current, false);
});

test('actual save handler rejects stale sessions even when documents share an ID', async () => {
  const gate = deferred();
  const started = deferred();
  let writes = 0;
  const state = saveHarness(async (doc, content) => { writes += 1; started.resolve(); await gate.promise; return saved(doc, content); });
  const pending = state.save();
  await started.promise;
  const queued = state.save();
  const reopened = { meta: { id: 'doc', filePath: '/copy.gwx', filename: 'copy.gwx' }, document: { text: 'copy' } };
  state.documentRef.current = reopened;
  state.editorContentRef.current = reopened.document;
  state.saveFlowRef.current.opened();
  gate.resolve();
  assert.deepEqual(await Promise.all([pending, queued]), [false, false]);
  assert.equal(state.documentRef.current, reopened);
  assert.equal(writes, 1);
});

test('actual cancelled and failed saves stay dirty and allow retry', async () => {
  let attempt = 0;
  const state = saveHarness(async (doc, content) => {
    attempt += 1;
    if (attempt === 1) return null;
    if (attempt === 2) throw new Error('disk full');
    return saved(doc, content);
  });
  assert.equal(await state.save(true), false);
  assert.equal(state.isDirtyRef.current, true);
  assert.equal(state.documentRef.current.meta.filePath, '/old.gwx');
  assert.equal(await state.save(), false);
  assert.match(state.dialogs[0], /disk full/);
  assert.equal(state.isDirtyRef.current, true);
  assert.equal(await state.save(), true);
  assert.equal(state.isDirtyRef.current, false);
});
