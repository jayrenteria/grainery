import assert from 'node:assert/strict';
import test from 'node:test';
import plugin from '../dist/main.js';

function createPanelHarness() {
  let panel = null;
  plugin.setup({
    registerDocumentTransform() {},
    registerEditorLandmarkProvider() {},
    registerUIControl() {},
    registerUIPanel(definition) {
      panel = definition;
    },
  });

  assert.ok(panel, 'Scene Manager panel should register');
  return panel;
}

function createScreenplay(sceneCount) {
  return {
    scenes() {
      return Array.from({ length: sceneCount }, (_, index) => {
        const number = index + 1;
        const from = 1 + index * 10;
        return {
          id: `scene-${number}`,
          number,
          from,
          heading: {
            index,
            from,
            to: from + 8,
            text: `INT. LOCATION ${number} - DAY`,
            attrs: { sceneNumber: number },
          },
        };
      });
    },
  };
}

test('chunks 65 scenes into host-valid action blocks', () => {
  const panel = createPanelHarness();
  const content = panel.onRender({
    document: { type: 'doc', content: [] },
    screenplay: createScreenplay(65),
    documentMode: 'screenplay',
    currentElementType: 'sceneHeading',
    selectionFrom: 1,
    selectionTo: 1,
    formValues: {},
  });

  const scroll = content.blocks.find((block) => block.type === 'scroll');
  assert.ok(scroll, 'Scene Manager should render a scroll block');
  const actionCounts = scroll.blocks.map(
    (block) => block.type === 'actions' ? block.actions.length : 0
  );
  assert.deepEqual(actionCounts, [64, 1]);
  assert.ok(actionCounts.every((count) => count <= 64));
});
