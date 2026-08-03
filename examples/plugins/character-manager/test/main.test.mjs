import assert from 'node:assert/strict';
import test from 'node:test';
import plugin from '../dist/main.js';

function createScreenplay(names) {
  const blocks = names.map((text, index) => ({ index, text }));
  return {
    characters() {
      return blocks;
    },
    setBlockText(index, text) {
      blocks[index].text = text;
    },
  };
}

function createPanelHarness(mutationDocument) {
  let panel = null;
  plugin.setup({
    registerEditorCompletionProvider() {},
    registerUIControl() {},
    registerUIPanel(definition) {
      panel = definition;
    },
    screenplay: {
      async mutate(callback) {
        return callback(mutationDocument);
      },
    },
  });

  assert.ok(panel, 'Character Manager panel should register');
  return panel;
}

function panelContext(documentId, screenplay, formValues = {}) {
  return {
    document: { type: 'doc', content: [] },
    screenplay,
    documentMode: 'screenplay',
    currentElementType: 'character',
    selectionFrom: 1,
    selectionTo: 1,
    formValues,
    metadata: { documentId },
  };
}

function selectedValue(content) {
  const summary = content.blocks.find((block) => block.type === 'keyValue');
  return summary?.items.find((item) => item.key === 'Selected')?.value;
}

test('resets selection, preview, and success when the document ID changes', async () => {
  const firstDocument = createScreenplay(['ALICE', 'ALICE']);
  const panel = createPanelHarness(firstDocument);
  const firstContext = panelContext('document-a', firstDocument);
  const renameValues = { 'rename-target-0': 'BOB' };

  await panel.onAction({ ...firstContext, actionId: 'source-0' });
  const preview = await panel.onAction({
    ...firstContext,
    actionId: 'preview-rename',
    formValues: renameValues,
  });
  assert.ok(
    preview.content.blocks.some((block) => block.type === 'callout' && block.title === 'Confirm mass rename')
  );

  await panel.onAction({
    ...firstContext,
    actionId: 'confirm-rename',
    formValues: renameValues,
  });
  const completed = panel.onRender(panelContext('document-a', firstDocument, renameValues));
  assert.equal(selectedValue(completed), 'BOB');
  assert.ok(
    completed.blocks.some((block) => block.type === 'callout' && block.title === 'Rename complete')
  );

  const secondDocument = createScreenplay(['BOB']);
  const reset = panel.onRender(panelContext('document-b', secondDocument));
  assert.equal(selectedValue(reset), '—');
  assert.ok(
    !reset.blocks.some((block) => block.type === 'callout' && block.title === 'Rename complete')
  );
  assert.ok(
    !reset.blocks.some((block) => block.type === 'callout' && block.title === 'Confirm mass rename')
  );
});
