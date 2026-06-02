import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const MANIFEST_FILE_NAME = 'grainery-plugin.manifest.json';
export const REQUIRED_PLUGIN_API_RANGE = '^1.2.0';
export const PLUGIN_ARCHIVE_EXTENSION = '.grainery-plugin.zip';

export const CORE_PERMISSIONS = new Set([
  'document:read',
  'document:write',
  'editor:commands',
  'export:register',
]);

export const OPTIONAL_PERMISSIONS = new Set([
  'fs:pick-read',
  'fs:pick-write',
  'network:https',
  'ui:mount',
  'editor:annotations',
]);

export const DOCUMENT_HOOKS = new Set(['post-open', 'pre-save', 'pre-export']);
export const LOCAL_ID_RE = /^[a-zA-Z0-9._-]+$/;
export const BUILTIN_ICONS = new Set([
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
export const UI_CONTROL_MOUNTS = new Set(['top-bar', 'bottom-bar']);
export const UI_CONTROL_KINDS = new Set(['button', 'toggle', 'segmented']);

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'version',
  'description',
  'engine',
  'entry',
  'permissions',
  'optionalPermissions',
  'networkAllowlist',
  'activationEvents',
  'contributes',
  'enabledApiProposals',
  'signature',
]);

const CONTRIBUTION_KEYS = [
  'commands',
  'exporters',
  'importers',
  'statusBadges',
  'inlineAnnotationProviders',
  'uiControls',
  'uiPanels',
  'transforms',
];

const IGNORED_PACKAGE_ENTRIES = new Set(['.DS_Store']);
const IGNORED_PACKAGE_DIRS = new Set(['.git', 'node_modules']);

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSemverLike(value) {
  return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+].*)?$/.test(value);
}

export function isValidLocalId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && LOCAL_ID_RE.test(value) && !value.includes(':');
}

export function isValidPluginId(value) {
  return isValidLocalId(value);
}

export function isValidActivationEvent(value) {
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

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function resolveManifestPath(target) {
  const absoluteTarget = path.resolve(process.cwd(), target);
  if (fs.existsSync(absoluteTarget) && fs.statSync(absoluteTarget).isDirectory()) {
    return path.join(absoluteTarget, MANIFEST_FILE_NAME);
  }
  return absoluteTarget;
}

function pushError(errors, message) {
  errors.push(message);
}

function pushWarning(warnings, message) {
  warnings.push(message);
}

function ensureArray(object, errors, pathName) {
  const value = object?.[pathName];
  if (!Array.isArray(value)) {
    pushError(errors, `${pathName} must be an array`);
    return [];
  }
  return value;
}

function validateNoUnknownKeys(object, allowedKeys, errors, pathName) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return;
  }

  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      pushError(errors, `${pathName} contains unknown property '${key}'`);
    }
  }
}

function validateUniqueStrings(items, errors, pathName) {
  const seen = new Set();
  for (const item of items) {
    if (typeof item !== 'string') {
      continue;
    }
    if (seen.has(item)) {
      pushError(errors, `${pathName} contains duplicate value '${item}'`);
    }
    seen.add(item);
  }
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

function createEmptyContributions() {
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

function validateContributes(contributes, errors) {
  if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) {
    pushError(errors, 'contributes must be an object');
    return createEmptyContributions();
  }

  validateNoUnknownKeys(contributes, new Set(CONTRIBUTION_KEYS), errors, 'contributes');

  const normalized = createEmptyContributions();
  for (const key of CONTRIBUTION_KEYS) {
    normalized[key] = ensureArray(contributes, errors, key);
  }

  validateContributedIdUniqueness(normalized.commands, errors, 'contributes.commands');
  validateContributedIdUniqueness(normalized.exporters, errors, 'contributes.exporters');
  validateContributedIdUniqueness(normalized.importers, errors, 'contributes.importers');
  validateContributedIdUniqueness(normalized.statusBadges, errors, 'contributes.statusBadges');
  validateContributedIdUniqueness(normalized.inlineAnnotationProviders, errors, 'contributes.inlineAnnotationProviders');
  validateContributedIdUniqueness(normalized.uiControls, errors, 'contributes.uiControls');
  validateContributedIdUniqueness(normalized.uiPanels, errors, 'contributes.uiPanels');
  validateContributedIdUniqueness(normalized.transforms, errors, 'contributes.transforms');

  for (const item of normalized.commands) {
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

  for (const item of normalized.exporters) {
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

  for (const item of normalized.importers) {
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

  for (const item of normalized.statusBadges) {
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

  for (const item of normalized.inlineAnnotationProviders) {
    if (!item || typeof item !== 'object') {
      pushError(errors, 'contributes.inlineAnnotationProviders entries must be objects');
      continue;
    }
    if (!isValidLocalId(item.id)) {
      pushError(errors, `Invalid contributes.inlineAnnotationProviders id: ${String(item.id)}`);
    }
  }

  for (const item of normalized.uiControls) {
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

  for (const item of normalized.uiPanels) {
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

  for (const item of normalized.transforms) {
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

  return normalized;
}

export function validatePluginManifest(manifest, options = {}) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest must be a JSON object'], warnings };
  }

  validateNoUnknownKeys(manifest, TOP_LEVEL_KEYS, errors, 'manifest');

  if (manifest.schemaVersion !== 1) {
    pushError(errors, 'schemaVersion must equal 1');
  }

  if (!isValidPluginId(manifest.id)) {
    pushError(errors, 'id must match ^[a-zA-Z0-9._-]+$, be <=64 chars, and must not include :');
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

  if (!manifest.engine || typeof manifest.engine !== 'object' || Array.isArray(manifest.engine)) {
    pushError(errors, 'engine object is required');
  } else {
    validateNoUnknownKeys(manifest.engine, new Set(['grainery', 'pluginApi']), errors, 'engine');
    if (!isNonEmptyString(manifest.engine.grainery)) {
      pushError(errors, 'engine.grainery is required');
    }
    if (manifest.engine.pluginApi !== REQUIRED_PLUGIN_API_RANGE) {
      pushError(errors, `engine.pluginApi must be exactly ${REQUIRED_PLUGIN_API_RANGE}`);
    }
  }

  if (!isNonEmptyString(manifest.entry) || manifest.entry.includes('..') || path.isAbsolute(manifest.entry)) {
    pushError(errors, 'entry must be a relative path without traversal');
  } else if (options.checkEntry && options.rootDir) {
    const entryPath = path.join(options.rootDir, manifest.entry);
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
      pushError(errors, `entry file does not exist: ${manifest.entry}`);
    }
  }

  const permissions = ensureArray(manifest, errors, 'permissions');
  validateUniqueStrings(permissions, errors, 'permissions');
  for (const permission of permissions) {
    if (!CORE_PERMISSIONS.has(permission)) {
      pushError(errors, `Unknown core permission: ${permission}`);
    }
  }

  const optionalPermissions = ensureArray(manifest, errors, 'optionalPermissions');
  validateUniqueStrings(optionalPermissions, errors, 'optionalPermissions');
  for (const permission of optionalPermissions) {
    if (!OPTIONAL_PERMISSIONS.has(permission)) {
      pushError(errors, `Unknown optional permission: ${permission}`);
    }
  }

  const networkAllowlist = ensureArray(manifest, errors, 'networkAllowlist');
  for (const host of networkAllowlist) {
    if (!isNonEmptyString(host)) {
      pushError(errors, 'networkAllowlist entries must be non-empty strings');
    }
  }
  if (networkAllowlist.length > 0 && !optionalPermissions.includes('network:https')) {
    pushWarning(warnings, 'networkAllowlist is set but optionalPermissions does not include network:https');
  }

  const activationEvents = ensureArray(manifest, errors, 'activationEvents');
  if (activationEvents.length === 0) {
    pushError(errors, 'activationEvents must include at least one event');
  }
  validateUniqueStrings(activationEvents, errors, 'activationEvents');
  for (const event of activationEvents) {
    if (!isNonEmptyString(event) || !isValidActivationEvent(event)) {
      pushError(errors, `Invalid activation event: ${String(event)}`);
    }
  }

  const contributes = validateContributes(manifest.contributes, errors);

  for (const event of activationEvents) {
    if (event === 'onStartup' || typeof event !== 'string') {
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
    } else {
      validateUniqueStrings(manifest.enabledApiProposals, errors, 'enabledApiProposals');
      if (manifest.enabledApiProposals.some((value) => !isNonEmptyString(value))) {
        pushError(errors, 'enabledApiProposals entries must be non-empty strings');
      }
    }
  }

  if (!manifest.signature || typeof manifest.signature !== 'object' || Array.isArray(manifest.signature)) {
    pushError(errors, 'signature object is required');
  } else {
    validateNoUnknownKeys(manifest.signature, new Set(['keyId', 'sha256', 'sig']), errors, 'signature');
    if (!isNonEmptyString(manifest.signature.keyId)) {
      pushError(errors, 'signature.keyId is required');
    }

    if (!isNonEmptyString(manifest.signature.sha256) || !/^[A-Fa-f0-9]{64}$/.test(manifest.signature.sha256)) {
      pushError(errors, 'signature.sha256 must be a 64-char hex string');
    }

    if (!isNonEmptyString(manifest.signature.sig)) {
      pushError(errors, 'signature.sig is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateManifestFile(target, options = {}) {
  const manifestPath = resolveManifestPath(target);
  if (!fs.existsSync(manifestPath)) {
    return {
      valid: false,
      manifestPath,
      errors: [`Manifest not found: ${manifestPath}`],
      warnings: [],
    };
  }

  let manifest;
  try {
    manifest = readJsonFile(manifestPath);
  } catch (error) {
    return {
      valid: false,
      manifestPath,
      errors: [`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
    };
  }

  const rootDir = path.dirname(manifestPath);
  return {
    manifestPath,
    manifest,
    ...validatePluginManifest(manifest, { ...options, rootDir }),
  };
}

export function listArchiveEntries(archivePath) {
  const result = spawnSync('unzip', ['-Z1', archivePath], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || 'Failed to list archive entries';
    throw new Error(message);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readArchiveEntry(archivePath, entryName) {
  const result = spawnSync('unzip', ['-p', archivePath, entryName], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `Failed to read ${entryName}`;
    throw new Error(message);
  }

  return result.stdout;
}

function archiveEntryIsUnsafe(entry) {
  return entry.startsWith('/') || entry.includes('..') || entry.includes('\\');
}

export function checkPluginArchive(target) {
  const archivePath = path.resolve(process.cwd(), target);
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(archivePath)) {
    return {
      valid: false,
      archivePath,
      entries: [],
      errors: [`Archive not found: ${archivePath}`],
      warnings,
    };
  }

  if (!archivePath.endsWith(PLUGIN_ARCHIVE_EXTENSION)) {
    pushWarning(warnings, `Plugin archive should use ${PLUGIN_ARCHIVE_EXTENSION}`);
  }

  let entries = [];
  try {
    entries = listArchiveEntries(archivePath);
  } catch (error) {
    return {
      valid: false,
      archivePath,
      entries,
      errors: [`Failed to inspect archive: ${error instanceof Error ? error.message : String(error)}`],
      warnings,
    };
  }

  if (entries.length === 0) {
    pushError(errors, 'Archive is empty');
  }

  for (const entry of entries) {
    if (archiveEntryIsUnsafe(entry)) {
      pushError(errors, `Archive entry is unsafe: ${entry}`);
    }
    if (entry.split('/').includes('__MACOSX') || path.basename(entry) === '.DS_Store') {
      pushWarning(warnings, `Archive contains local metadata file: ${entry}`);
    }
  }

  if (!entries.includes(MANIFEST_FILE_NAME)) {
    const nestedManifest = entries.find((entry) => entry.endsWith(`/${MANIFEST_FILE_NAME}`));
    if (nestedManifest) {
      pushError(errors, `${MANIFEST_FILE_NAME} must be at archive root, found nested at ${nestedManifest}`);
    } else {
      pushError(errors, `Archive missing ${MANIFEST_FILE_NAME}`);
    }
  }

  let manifest = null;
  if (entries.includes(MANIFEST_FILE_NAME)) {
    try {
      manifest = JSON.parse(readArchiveEntry(archivePath, MANIFEST_FILE_NAME));
    } catch (error) {
      pushError(errors, `Failed to parse archive manifest: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (manifest) {
    const result = validatePluginManifest(manifest);
    errors.push(...result.errors);
    warnings.push(...result.warnings);

    if (isNonEmptyString(manifest.entry) && !entries.includes(manifest.entry)) {
      pushError(errors, `Archive missing manifest entry file: ${manifest.entry}`);
    }
  }

  return {
    valid: errors.length === 0,
    archivePath,
    entries,
    manifest,
    errors,
    warnings,
  };
}

function walkPackageEntries(rootDir, currentDir = rootDir, entries = []) {
  for (const name of fs.readdirSync(currentDir)) {
    if (IGNORED_PACKAGE_ENTRIES.has(name) || IGNORED_PACKAGE_DIRS.has(name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, name);
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');

    if (relativePath.endsWith(PLUGIN_ARCHIVE_EXTENSION)) {
      continue;
    }

    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      walkPackageEntries(rootDir, absolutePath, entries);
    } else if (stat.isFile()) {
      entries.push(relativePath);
    }
  }

  return entries;
}

export function packagePlugin(pluginDir, options = {}) {
  const rootDir = path.resolve(process.cwd(), pluginDir);
  const manifestPath = path.join(rootDir, MANIFEST_FILE_NAME);

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`Plugin directory not found: ${rootDir}`);
  }

  const manifestResult = validateManifestFile(manifestPath, { checkEntry: true });
  if (!manifestResult.valid) {
    throw new Error(`Manifest validation failed:\n${manifestResult.errors.map((error) => `- ${error}`).join('\n')}`);
  }

  const archiveName = options.out
    ? path.resolve(process.cwd(), options.out)
    : path.join(rootDir, `${manifestResult.manifest.id}${PLUGIN_ARCHIVE_EXTENSION}`);
  const entries = walkPackageEntries(rootDir);

  if (!entries.includes(MANIFEST_FILE_NAME)) {
    throw new Error(`${MANIFEST_FILE_NAME} must be at plugin directory root`);
  }

  if (entries.length === 0) {
    throw new Error('No files to package');
  }

  fs.mkdirSync(path.dirname(archiveName), { recursive: true });
  if (fs.existsSync(archiveName)) {
    fs.unlinkSync(archiveName);
  }

  const zipResult = spawnSync('zip', ['-q', '-r', archiveName, ...entries], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (zipResult.status !== 0) {
    const message = zipResult.stderr.trim() || zipResult.stdout.trim() || 'zip failed';
    throw new Error(message);
  }

  const archiveResult = checkPluginArchive(archiveName);
  if (!archiveResult.valid) {
    throw new Error(`Archive validation failed:\n${archiveResult.errors.map((error) => `- ${error}`).join('\n')}`);
  }

  return {
    archivePath: archiveName,
    entries,
    warnings: [...manifestResult.warnings, ...archiveResult.warnings],
  };
}

function toPluginId(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function toTitle(input) {
  return input
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function replaceTemplateTokens(value, replacements) {
  let output = value;
  for (const [key, replacement] of Object.entries(replacements)) {
    output = output.replaceAll(`__${key}__`, replacement);
  }
  return output;
}

function copyTemplateDirectory(templateDir, targetDir, replacements) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const name of fs.readdirSync(templateDir)) {
    const sourcePath = path.join(templateDir, name);
    const targetName = replaceTemplateTokens(name, replacements);
    const targetPath = path.join(targetDir, targetName);
    const stat = fs.statSync(sourcePath);

    if (stat.isDirectory()) {
      copyTemplateDirectory(sourcePath, targetPath, replacements);
      continue;
    }

    const source = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(targetPath, replaceTemplateTokens(source, replacements));
  }
}

export function createPluginProject(targetDir, options = {}) {
  const destination = path.resolve(process.cwd(), targetDir);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
    throw new Error(`Target directory is not empty: ${destination}`);
  }

  const rawName = options.name || path.basename(destination);
  const localId = toPluginId(options.id || rawName || 'my-plugin');
  const pluginId = localId.includes('.') ? localId : `com.example.${localId}`;
  const title = options.name || toTitle(localId.replace(/^com\.example\./, ''));
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const templateDir = path.join(repoRoot, 'templates/plugin-basic');
  const sdkPackageDir = path.join(repoRoot, 'packages/plugin-sdk');
  const cliPath = path.join(repoRoot, 'scripts/grainery-plugin.mjs');

  copyTemplateDirectory(templateDir, destination, {
    PLUGIN_ID: pluginId,
    PLUGIN_NAME: title,
    PACKAGE_NAME: localId.replace(/^com\.example\./, ''),
    SDK_FILE_SPEC: sdkPackageDir,
    TOOL_PATH: cliPath,
  });

  return {
    destination,
    pluginId,
    name: title,
  };
}
