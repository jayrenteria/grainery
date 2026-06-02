#!/usr/bin/env node

import { validateManifestFile } from './lib/plugin-toolkit.mjs';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/validate-plugin-manifest.mjs <manifest-path|plugin-dir>');
  process.exit(2);
}

const result = validateManifestFile(target, { checkEntry: process.argv.includes('--check-entry') });

for (const warning of result.warnings) {
  console.warn(`Warning: ${warning}`);
}

if (!result.valid) {
  console.error(`Manifest validation failed for ${result.manifestPath}:`);
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Manifest is valid: ${result.manifestPath}`);
