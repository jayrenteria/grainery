import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));

const packageVersion = packageJson.version;
const tauriVersion = tauriConfig.version;
const refName = process.env.GITHUB_REF_NAME;

if (packageVersion !== tauriVersion) {
  throw new Error(
    `Version mismatch: package.json is ${packageVersion}, but src-tauri/tauri.conf.json is ${tauriVersion}.`,
  );
}

if (refName) {
  const expectedTag = `app-v${tauriVersion}`;

  if (refName !== expectedTag) {
    throw new Error(`Release tag mismatch: pushed ${refName}, but app version expects ${expectedTag}.`);
  }
}
