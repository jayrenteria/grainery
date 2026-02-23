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
  'editor:annotations',
]);

const DOCUMENT_HOOKS = new Set(['post-open', 'pre-save', 'pre-export']);
const LOCAL_ID_RE = /^[a-zA-Z0-9._-]+$/;
const BUILTIN_ICONS = new Set([
  'scene-heading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'chevron-left',
  'chevron-right',
  'panel',
  'close',
  'settings',
  'spark',
]);
const UI_CONTROL_MOUNTS = new Set(['top-bar', 'bottom-bar']);
const UI_CONTROL_KINDS = new Set(['button', 'toggle', 'segmented']);

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

function isValidLocalId(value) {
  return typeof value === 'string' && LOCAL_ID_RE.test(value) && !value.includes(':');
}

function isValidActivationEvent(value) {
  if (value === 'onStartup') {
    return true;
  }

  const prefixes = [
    'onCommand:',
    'onExporter:',
    'onImporter:',
    'onUIControl:',
    'onUIPanel:',
    'onStatusBadge:',
    'onInlineAnnotations:',
  ];

  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return isValidLocalId(value.slice(prefix.length));
    }
  }

  if (value.startsWith('onTransform:')) {
    return DOCUMENT_HOOKS.has(value.slice('onTransform:'.length));
  }

  return false;
}

function ensureArray(manifest, errors, pathName) {
  const value = manifest[pathName];
  if (!Array.isArray(value)) {
    pushError(errors, `${pathName} must be an array`);
    return [];
  }
  return value;
}

function validateContributedIdUniqueness(items, errors, pathName) {
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const id = item.id;
    if (typeof id !== 'string') {
      continue;
    }

    if (seen.has(id)) {
      pushError(errors, `${pathName} contains duplicate id '${id}'`);
    }
    seen.add(id);
  }
}

function validateContributes(contributes, errors) {
  if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) {
    pushError(errors, 'contributes must be an object');
    return {
      commands: [],
      exporters: [],
      importers: [],
      statusBadges: [],
      inlineAnnotationProviders: [],
      uiControls: [],
      uiPanels: [],
      transforms: [],
    };
  }

  const commands = ensureArray(contributes, errors, 'commands');
  const exporters = ensureArray(contributes, errors, 'exporters');
  const importers = ensureArray(contributes, errors, 'importers');
  const statusBadges = ensureArray(contributes, errors, 'statusBadges');
  const inlineAnnotationProviders = ensureArray(contributes, errors, 'inlineAnnotationProviders');
  const uiControls = ensureArray(contributes, errors, 'uiControls');
  const uiPanels = ensureArray(contributes, errors, 'uiPanels');
  const transforms = ensureArray(contributes, errors, 'transforms');

  validateContributedIdUniqueness(commands, errors, 'contributes.commands');
  validateContributedIdUniqueness(exporters, errors, 'contributes.exporters');
  validateContributedIdUniqueness(importers, errors, 'contributes.importers');
  validateContributedIdUniqueness(statusBadges, errors, 'contributes.statusBadges');
  validateContributedIdUniqueness(inlineAnnotationProviders, errors, 'contributes.inlineAnnotationProviders');
  validateContributedIdUniqueness(uiControls, errors, 'contributes.uiControls');
  validateContributedIdUniqueness(uiPanels, errors, 'contributes.uiPanels');
  validateContributedIdUniqueness(transforms, errors, 'contributes.transforms');

  for (const item of commands) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.commands entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.commands id: ${String(item.id)}`);
    }
    if (!isNonEmptyString(item.title)) {
      pushError(errors, `contributes.commands '${String(item.id)}' title is required`);
    }
  }

  for (const item of exporters) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.exporters entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.exporters id: ${String(item.id)}`);
    }
    if (!isNonEmptyString(item.title)) {
      pushError(errors, `contributes.exporters '${String(item.id)}' title is required`);
    }
    if (!isNonEmptyString(item.extension)) {
      pushError(errors, `contributes.exporters '${String(item.id)}' extension is required`);
    }
  }

  for (const item of importers) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.importers entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.importers id: ${String(item.id)}`);
    }
    if (!isNonEmptyString(item.title)) {
      pushError(errors, `contributes.importers '${String(item.id)}' title is required`);
    }
    if (!Array.isArray(item.extensions) || item.extensions.length === 0) {
      pushError(errors, `contributes.importers '${String(item.id)}' must include at least one extension`);
    }
  }

  for (const item of statusBadges) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.statusBadges entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.statusBadges id: ${String(item.id)}`);
    }
    if (!isNonEmptyString(item.label)) {
      pushError(errors, `contributes.statusBadges '${String(item.id)}' label is required`);
    }
  }

  for (const item of inlineAnnotationProviders) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.inlineAnnotationProviders entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.inlineAnnotationProviders id: ${String(item.id)}`);
    }
  }

  for (const item of uiControls) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.uiControls entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.uiControls id: ${String(item.id)}`);
    }
    if (!UI_CONTROL_MOUNTS.has(item.mount)) {
      pushError(errors, `contributes.uiControls '${String(item.id)}' has invalid mount`);
    }
    if (!UI_CONTROL_KINDS.has(item.kind)) {
      pushError(errors, `contributes.uiControls '${String(item.id)}' has invalid kind`);
    }
    if (!isNonEmptyString(item.label)) {
      pushError(errors, `contributes.uiControls '${String(item.id)}' label is required`);
    }
    if (!BUILTIN_ICONS.has(item.icon)) {
      pushError(errors, `contributes.uiControls '${String(item.id)}' has invalid icon`);
    }
  }

  for (const item of uiPanels) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.uiPanels entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.uiPanels id: ${String(item.id)}`);
    }
    if (!isNonEmptyString(item.title)) {
      pushError(errors, `contributes.uiPanels '${String(item.id)}' title is required`);
    }
    if (typeof item.icon === 'string' && !BUILTIN_ICONS.has(item.icon)) {
      pushError(errors, `contributes.uiPanels '${String(item.id)}' has invalid icon`);
    }
  }

  for (const item of transforms) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.transforms entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.transforms id: ${String(item.id)}`);
    }
    if (!DOCUMENT_HOOKS.has(item.hook)) {
      pushError(errors, `contributes.transforms '${String(item.id)}' has invalid hook`);
    }
  }

  return {
    commands,
    exporters,
    importers,
    statusBadges,
    inlineAnnotationProviders,
    uiControls,
    uiPanels,
    transforms,
  };
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

if (!isNonEmptyString(manifest.id) || !LOCAL_ID_RE.test(manifest.id)) {
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
  if (manifest.engine.pluginApi !== '^1.2.0') {
    pushError(errors, 'engine.pluginApi must be exactly ^1.2.0');
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

if (!Array.isArray(manifest.activationEvents) || manifest.activationEvents.length === 0) {
  pushError(errors, 'activationEvents must be a non-empty array');
} else {
  const seen = new Set();
  for (const event of manifest.activationEvents) {
    if (!isNonEmptyString(event) || !isValidActivationEvent(event)) {
      pushError(errors, `Invalid activation event: ${String(event)}`);
      continue;
    }
    if (seen.has(event)) {
      pushError(errors, `Duplicate activation event: ${event}`);
    }
    seen.add(event);
  }
}

const contributes = validateContributes(manifest.contributes, errors);

for (const event of Array.isArray(manifest.activationEvents) ? manifest.activationEvents : []) {
  if (event === 'onStartup') {
    continue;
  }

  const [kind, localId] = event.split(':', 2);
  if (!localId) {
    continue;
  }

  let source = [];
  if (kind === 'onCommand') source = contributes.commands;
  if (kind === 'onExporter') source = contributes.exporters;
  if (kind === 'onImporter') source = contributes.importers;
  if (kind === 'onUIControl') source = contributes.uiControls;
  if (kind === 'onUIPanel') source = contributes.uiPanels;
  if (kind === 'onStatusBadge') source = contributes.statusBadges;
  if (kind === 'onInlineAnnotations') source = contributes.inlineAnnotationProviders;
  if (kind === 'onTransform') source = contributes.transforms;

  if (!source.some((item) => item.id === localId || item.hook === localId)) {
    pushError(errors, `activationEvents references missing contribution: ${event}`);
  }
}

if (manifest.enabledApiProposals !== undefined) {
  if (!Array.isArray(manifest.enabledApiProposals)) {
    pushError(errors, 'enabledApiProposals must be an array when provided');
  } else if (manifest.enabledApiProposals.some((value) => !isNonEmptyString(value))) {
    pushError(errors, 'enabledApiProposals entries must be non-empty strings');
  }
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
