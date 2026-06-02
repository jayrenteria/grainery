#!/usr/bin/env node

import {
  checkPluginArchive,
  createPluginProject,
  packagePlugin,
  validateManifestFile,
} from './lib/plugin-toolkit.mjs';

function usage() {
  console.error(`Usage:
  node scripts/grainery-plugin.mjs create <target-dir> [--id <plugin-id>] [--name <name>]
  node scripts/grainery-plugin.mjs validate <manifest-path|plugin-dir> [--check-entry]
  node scripts/grainery-plugin.mjs pack <plugin-dir> [--out <archive.grainery-plugin.zip>]
  node scripts/grainery-plugin.mjs check-archive <archive.grainery-plugin.zip>`);
  process.exit(2);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function printWarnings(warnings) {
  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }
}

function fail(title, errors) {
  console.error(title);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const [command, target, ...args] = process.argv.slice(2);
if (!command || !target) {
  usage();
}

try {
  if (command === 'create') {
    const result = createPluginProject(target, {
      id: readOption(args, '--id'),
      name: readOption(args, '--name'),
    });
    console.log(`Created Grainery plugin project: ${result.destination}`);
    console.log(`Plugin id: ${result.pluginId}`);
    console.log('Next steps: npm install, npm run build, npm run pack');
    process.exit(0);
  }

  if (command === 'validate') {
    const result = validateManifestFile(target, { checkEntry: args.includes('--check-entry') });
    printWarnings(result.warnings);
    if (!result.valid) {
      fail(`Manifest validation failed for ${result.manifestPath}:`, result.errors);
    }
    console.log(`Manifest is valid: ${result.manifestPath}`);
    process.exit(0);
  }

  if (command === 'pack') {
    const result = packagePlugin(target, {
      out: readOption(args, '--out'),
    });
    printWarnings(result.warnings);
    console.log(`Packaged plugin: ${result.archivePath}`);
    console.log(`Files included: ${result.entries.length}`);
    process.exit(0);
  }

  if (command === 'check-archive') {
    const result = checkPluginArchive(target);
    printWarnings(result.warnings);
    if (!result.valid) {
      fail(`Archive validation failed for ${result.archivePath}:`, result.errors);
    }
    console.log(`Archive is valid: ${result.archivePath}`);
    console.log(`Files included: ${result.entries.length}`);
    process.exit(0);
  }

  usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
