import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/release-macos.sh');

test('Mac releases require credentials, stop on verification failures, and clean up the API key', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'grainery-release-test-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const stub = join(bin, 'stub.mjs');
    writeFileSync(stub, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync('commands.jsonl', JSON.stringify([command, ...args]) + '\\n');
if (command === process.env.FAIL_COMMAND) process.exit(42);
if (command === 'npm') {
  if ((statSync(process.env.APPLE_API_KEY_PATH).mode & 0o777) !== 0o600) process.exit(43);
  writeFileSync('key-path', process.env.APPLE_API_KEY_PATH);
  const target = args[args.indexOf('--target') + 1];
  const bundle = join('src-tauri/target', target, 'release/bundle');
  mkdirSync(join(bundle, 'macos/Grainery.app'), { recursive: true });
  mkdirSync(join(bundle, 'dmg'), { recursive: true });
  writeFileSync(join(bundle, 'macos/Grainery.app.tar.gz'), 'updater');
  if (!process.env.MISSING_UPDATER_SIGNATURE) writeFileSync(join(bundle, 'macos/Grainery.app.tar.gz.sig'), 'signature');
  writeFileSync(join(bundle, 'dmg/Grainery.dmg'), 'installer');
}
if (command === 'xcrun' && args[0] === 'notarytool') {
  console.log(JSON.stringify({ status: process.env.NOTARY_STATUS || 'Accepted' }));
}
`, { mode: 0o755 });
    for (const command of ['npm', 'codesign', 'xcrun', 'spctl', 'hdiutil']) symlinkSync(stub, join(bin, command));

    let iteration = 0;
    function run(overrides = {}, target = 'aarch64-apple-darwin') {
      const cwd = join(root, String(iteration++));
      mkdirSync(cwd);
      const result = spawnSync('bash', [script, 'build', '--target', target], {
        cwd, encoding: 'utf8',
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: cwd,
          APPLE_CERTIFICATE: 'test-certificate', APPLE_CERTIFICATE_PASSWORD: 'test-password',
          APPLE_SIGNING_IDENTITY: 'Developer ID Application: Test (TEAM)',
          APPLE_API_KEY: 'test-key-id', APPLE_API_ISSUER: 'test-issuer',
          APPLE_API_PRIVATE_KEY: 'test-private-key', ...overrides,
        },
      });
      const logPath = join(cwd, 'commands.jsonl');
      const commands = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse) : [];
      const keyPath = join(cwd, 'key-path');
      if (existsSync(keyPath)) assert.equal(existsSync(readFileSync(keyPath, 'utf8')), false, 'temporary key must be removed');
      assert.doesNotMatch(result.stdout + result.stderr, /test-private-key|test-password/);
      return { ...result, commands };
    }

    for (const target of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) {
      const success = run({}, target);
      assert.equal(success.status, 0, success.stderr);
      assert.deepEqual(success.commands.at(-1).slice(0, 4), ['spctl', '--assess', '--type', 'open']);
      assert(success.commands.some(([cmd, sub, action]) => cmd === 'xcrun' && sub === 'stapler' && action === 'staple'));
    }
    const missing = run({ APPLE_API_PRIVATE_KEY: '' });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Missing required release secret: APPLE_API_PRIVATE_KEY/);
    assert.equal(missing.commands.length, 0, 'credentials must be checked before building');
    assert.notEqual(run({ APPLE_SIGNING_IDENTITY: '-' }).status, 0);
    assert.notEqual(run({}, 'unknown-target').status, 0);
    for (const command of ['npm', 'codesign', 'spctl', 'hdiutil', 'xcrun']) {
      const failure = run({ FAIL_COMMAND: command });
      assert.equal(failure.status, 42, failure.stderr);
      assert.equal(failure.commands.at(-1)[0], command, 'failure must stop the release');
    }
    assert.notEqual(run({ MISSING_UPDATER_SIGNATURE: '1' }).status, 0);
    const rejected = run({ NOTARY_STATUS: 'Invalid' });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Installer notarization failed: Invalid/);
    assert.deepEqual(rejected.commands.at(-1).slice(0, 3), ['xcrun', 'notarytool', 'submit']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
