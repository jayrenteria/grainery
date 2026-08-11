import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import {
  createPluginProject,
  packagePlugin,
  validatePluginManifest,
} from '../scripts/lib/plugin-toolkit.mjs';

const documentHelpersSource = await readFile(
  new URL('../src/plugins/document-helpers.ts', import.meta.url),
  'utf8'
);
const documentHelpersModule = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(documentHelpersSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText
  ).toString('base64')}`
);
const { ScreenplayDocument } = documentHelpersModule;

test('setBlockText preserves inline mark spans and block attributes', () => {
  const screenplay = ScreenplayDocument.from({
    type: 'doc',
    content: [
      {
        type: 'character',
        attrs: { extension: 'V.O.' },
        content: [
          { type: 'text', text: 'ALI', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'CE', marks: [{ type: 'italic' }] },
        ],
      },
    ],
  });

  screenplay.setBlockText(0, 'BOBBY SMITH');

  assert.deepEqual(screenplay.toJSON().content?.[0], {
    type: 'character',
    attrs: { extension: 'V.O.' },
    content: [
      { type: 'text', text: 'BOBBY S', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'MITH', marks: [{ type: 'italic' }] },
    ],
  });
});

test('editor providers require startup activation', async () => {
  const template = JSON.parse(
    await readFile(new URL('../templates/plugin-basic/grainery-plugin.manifest.json', import.meta.url))
  );
  template.id = 'test.plugin';
  template.contributes.editorCompletionProviders = [{ id: 'characters' }];

  const rejected = validatePluginManifest(template);
  assert.equal(rejected.valid, false);
  assert.ok(
    rejected.errors.includes(
      'Editor completion and landmark providers require activationEvents to include onStartup'
    )
  );

  template.activationEvents.push('onStartup');
  assert.equal(validatePluginManifest(template).valid, true);
});

test('manifest signature is optional and never establishes registry trust', async () => {
  const template = JSON.parse(
    await readFile(new URL('../templates/plugin-basic/grainery-plugin.manifest.json', import.meta.url))
  );
  template.id = 'test.plugin';

  delete template.signature;
  assert.equal(validatePluginManifest(template).valid, true);

  template.signature = {
    keyId: 'author-key',
    sha256: '0'.repeat(64),
    sig: 'author-signature',
  };
  const withSignature = validatePluginManifest(template);
  assert.equal(withSignature.valid, true);
  assert.ok(withSignature.warnings.some((warning) => warning.includes('does not establish registry trust')));
});

test('plugin ids are canonical lowercase names', async () => {
  const template = JSON.parse(
    await readFile(new URL('../templates/plugin-basic/grainery-plugin.manifest.json', import.meta.url))
  );
  template.id = 'test.plugin';

  assert.equal(validatePluginManifest(template).valid, true);
  for (const invalidId of ['.', '..', 'Test.Plugin', 'test/Plugin']) {
    template.id = invalidId;
    assert.equal(validatePluginManifest(template).valid, false, invalidId);
  }
});

test('generated plugins omit embedded signatures', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'grainery-plugin-create-'));
  const pluginDir = path.join(root, 'plugin');

  try {
    createPluginProject(pluginDir, { id: 'Example.Plugin', name: 'Example Plugin' });
    const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'grainery-plugin.manifest.json'), 'utf8'));
    assert.equal(manifest.id, 'example.plugin');
    assert.equal('signature' in manifest, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('archive checker enforces the entry-count limit', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'grainery-plugin-archive-'));
  const pluginDir = path.join(root, 'plugin');

  try {
    createPluginProject(pluginDir, { id: 'test.archive-limit', name: 'Archive Limit' });
    mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(path.join(pluginDir, 'dist/main.js'), 'export default {};');
    mkdirSync(path.join(pluginDir, 'assets'));
    for (let index = 0; index < 251; index += 1) {
      writeFileSync(path.join(pluginDir, `assets/${index}.txt`), 'x');
    }

    assert.throws(() => packagePlugin(pluginDir), /more than 256 entries/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
