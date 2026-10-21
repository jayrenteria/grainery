import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const manifest = fileURLToPath(new URL('../../src-tauri/Cargo.toml', import.meta.url));

test('updater artifacts use Tauri 2 formats, not legacy Windows ZIP archives', () => {
  const config = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url)));
  assert.equal(config.bundle.createUpdaterArtifacts, true);
});

for (const [target, needsArchives] of [
  ['x86_64-pc-windows-msvc', false],
  ['x86_64-unknown-linux-gnu', true],
  ['aarch64-apple-darwin', false],
]) {
  test(`updater archive support is ${needsArchives ? 'enabled' : 'disabled'} for ${target}`, () => {
    const result = spawnSync('cargo', [
      'tree', '--manifest-path', manifest, '--locked', '--target', target,
      '--edges', 'features', '--invert', 'tauri-plugin-updater',
    ], { encoding: 'utf8', timeout: 120_000 });

    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /tauri-plugin-updater feature "rustls-tls"/);
    assert.equal(
      result.stdout.includes('tauri-plugin-updater feature "zip"'),
      needsArchives,
      result.stdout
    );
  });
}
