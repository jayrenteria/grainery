import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { Schema } from '@tiptap/pm/model';
import ts from 'typescript';

const compiledDirectory = mkdtempSync(join(process.cwd(), '.grainery-pagination-'));
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

const constantsSource = readFileSync(
  new URL('../src/lib/paginationConstants.ts', import.meta.url),
  'utf8'
);
writeFileSync(join(compiledDirectory, 'paginationConstants.mjs'), transpile(constantsSource));

const paginationSource = readFileSync(
  new URL('../src/lib/computePagination.ts', import.meta.url),
  'utf8'
);
writeFileSync(
  join(compiledDirectory, 'computePagination.mjs'),
  transpile(paginationSource).replace('./paginationConstants', './paginationConstants.mjs')
);

after(() => rmSync(compiledDirectory, { recursive: true, force: true }));

const { computePagination } = await import(
  pathToFileURL(join(compiledDirectory, 'computePagination.mjs')).href
);

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    caption: { content: 'text*', group: 'block' },
    action: { content: 'text*', group: 'block' },
    sceneHeading: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
});

test('places an automatic page break before a landmarked scene heading', () => {
  const sceneHeading = schema.node('sceneHeading', null, schema.text('INT. OFFICE - DAY'));
  const doc = schema.node('doc', null, [
    ...Array.from({ length: 52 }, () => schema.node('caption', null, schema.text('X'))),
    sceneHeading,
    schema.node('action', null, schema.text('Action')),
  ]);
  const scenePosition = 52 * schema.node('caption', null, schema.text('X')).nodeSize;

  const result = computePagination(doc);

  assert.equal(result.breaks[0].pos, scenePosition);
});
