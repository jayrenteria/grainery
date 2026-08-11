import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const editorSource = await readFile(
  new URL('../src/components/Editor/ScreenplayEditor.tsx', import.meta.url),
  'utf8'
);

test('new documents replace the TipTap instance inside a single editor shell', () => {
  const handler = appSource.slice(
    appSource.indexOf('const handleNew ='),
    appSource.indexOf('const confirmQuitWithUnsavedChanges =')
  );

  assert.doesNotMatch(handler, /setView\('start'\)/);
  assert.match(appSource, /<ScreenplayEditor\s+documentId=\{document\.meta\.id\}/);
  assert.doesNotMatch(appSource, /<ScreenplayEditor\s+key=/);
  assert.match(editorSource, /}, \[documentId, documentMode\]\);/);
});
