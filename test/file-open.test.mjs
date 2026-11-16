import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/fileOpen.ts', import.meta.url), 'utf8');
const { createFileOpenDrain } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText).toString('base64')}`);

test('startup and live wakeups drain once, opening only the first file in a batch', async () => {
  let queue = ['first.gwx', 'ignored.gwx'];
  const opened = [];
  let release;
  const confirm = new Promise((resolve) => { release = resolve; });
  const drain = createFileOpenDrain(async () => {
    const paths = queue; queue = []; return paths;
  }, async (path) => { opened.push(path); await confirm; return false; });
  const startup = drain();
  await Promise.resolve(); await Promise.resolve();
  queue.push('next.gwx');
  const live = drain();
  const duplicateWakeup = drain();
  assert.deepEqual(opened, ['first.gwx'], 'confirmation is serialized');
  release();
  await Promise.all([startup, live, duplicateWakeup]);
  assert.deepEqual(opened, ['first.gwx', 'next.gwx'], 'cancelled confirmation is not replayed');
});

test('a failed open does not prevent later wakeups', async () => {
  let queue = ['bad.gwx'];
  const drain = createFileOpenDrain(async () => { const paths = queue; queue = []; return paths; }, async (path) => {
    if (path === 'bad.gwx') throw new Error('invalid document');
  });
  await assert.rejects(drain(), /invalid document/);
  queue = ['good.gwx'];
  await drain();
});
