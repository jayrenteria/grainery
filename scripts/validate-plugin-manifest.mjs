#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const CORE_PERMISSIONS = new Set([
  'document:read',
  'document:write',
  'editor:commands',
  'export:register',
]);

const OPTIONAL_PERMISSIONS = new Set([
  'fs:pick-read',
  'fs:pick-write',
  'network:https',
  'ui:mount',
]);

function usage() {
  console.error('Usage: node scripts/validate-plugin-manifest.mjs <manifest-path>');
  process.exit(2);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSemverLike(value) {
  return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+].*)?$/.test(value);
}

function pushError(errors, message) {
  errors.push(message);
}

const target = process.argv[2];
if (!target) {
  usage();
}

const manifestPath = path.resolve(process.cwd(), target);

if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const errors = [];

if (manifest.schemaVersion !== 1) {
  pushError(errors, 'schemaVersion must equal 1');
}

if (!isNonEmptyString(manifest.id) || !/^[a-zA-Z0-9._-]+$/.test(manifest.id)) {
  pushError(errors, 'id must match ^[a-zA-Z0-9._-]+$');
}

if (!isNonEmptyString(manifest.name)) {
  pushError(errors, 'name is required');
}

if (!isSemverLike(manifest.version)) {
  pushError(errors, 'version must be semver-like (x.y.z)');
}

if (!isNonEmptyString(manifest.description)) {
  pushError(errors, 'description is required');
}

if (!manifest.engine || typeof manifest.engine !== 'object') {
  pushError(errors, 'engine object is required');
} else {
  if (!isNonEmptyString(manifest.engine.grainery)) {
    pushError(errors, 'engine.grainery is required');
  }
  if (!isNonEmptyString(manifest.engine.pluginApi)) {
    pushError(errors, 'engine.pluginApi is required');
  }
}

if (!isNonEmptyString(manifest.entry) || manifest.entry.includes('..') || path.isAbsolute(manifest.entry)) {
  pushError(errors, 'entry must be a relative path without traversal');
}

if (!Array.isArray(manifest.permissions)) {
  pushError(errors, 'permissions must be an array');
} else {
  for (const permission of manifest.permissions) {
    if (!CORE_PERMISSIONS.has(permission)) {
      pushError(errors, `Unknown core permission: ${permission}`);
    }
  }
}

if (!Array.isArray(manifest.optionalPermissions)) {
  pushError(errors, 'optionalPermissions must be an array');
} else {
  for (const permission of manifest.optionalPermissions) {
    if (!OPTIONAL_PERMISSIONS.has(permission)) {
      pushError(errors, `Unknown optional permission: ${permission}`);
    }
  }
}

if (!Array.isArray(manifest.networkAllowlist)) {
  pushError(errors, 'networkAllowlist must be an array');
}

if (!manifest.signature || typeof manifest.signature !== 'object') {
  pushError(errors, 'signature object is required');
} else {
  if (!isNonEmptyString(manifest.signature.keyId)) {
    pushError(errors, 'signature.keyId is required');
  }

  if (
    !isNonEmptyString(manifest.signature.sha256) ||
    !/^[A-Fa-f0-9]{64}$/.test(manifest.signature.sha256)
  ) {
    pushError(errors, 'signature.sha256 must be a 64-char hex string');
  }

  if (!isNonEmptyString(manifest.signature.sig)) {
    pushError(errors, 'signature.sig is required');
  }
}

if (errors.length > 0) {
  console.error(`Manifest validation failed for ${manifestPath}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Manifest is valid: ${manifestPath}`);
