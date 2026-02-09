import type { JSONContent } from '@tiptap/react';
import type { ScreenplayElementType } from '../lib/types';

export type CorePermission =
  | 'document:read'
  | 'document:write'
  | 'editor:commands'
  | 'export:register';

export type OptionalPermission =
  | 'fs:pick-read'
  | 'fs:pick-write'
  | 'network:https';

export type PluginPermission = CorePermission | OptionalPermission;

export interface PluginManifestEngine {
  grainery: string;
  pluginApi: string;
}

export interface PluginSignature {
  keyId: string;
  sha256: string;
  sig: string;
}

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  engine: PluginManifestEngine;
  entry: string;
  permissions: CorePermission[];
  optionalPermissions: OptionalPermission[];
  networkAllowlist: string[];
  signature?: PluginSignature;
}

export type PluginInstallSource = 'sideload' | 'registry';

export type PluginTrustState = 'verified' | 'unverified';

export interface PluginPermissionGrant {
  permission: OptionalPermission;
  granted: boolean;
  grantedAt: string | null;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  trust: PluginTrustState;
  installSource: PluginInstallSource;
  installedAt: string;
  updatedAt: string;
  entryPath: string;
  entrySource?: string | null;
  crashCount: number;
  networkAllowlist: string[];
  manifest: PluginManifest;
  grantedPermissions: PluginPermissionGrant[];
}

export interface PluginRegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  manifest: PluginManifest;
  downloadUrl: string;
  sha256: string;
  signatureKeyId: string;
  signature: string;
}

export interface PluginLockRecord {
  pluginId: string;
  version: string;
  sha256: string;
  signatureVerified: boolean;
  trust: PluginTrustState;
  enabled: boolean;
  grantedPermissions: PluginPermissionGrant[];
  updatedAt: string;
}

export type HostOperation =
  | 'document:get'
  | 'document:replace'
  | 'network:get_json'
  | 'network:get_text'
  | 'audit:log';

export type ElementLoopEvent = 'tab' | 'shift-tab' | 'enter' | 'escape';

export interface ElementLoopContext {
  event: ElementLoopEvent;
  currentType: ScreenplayElementType;
  previousType: string | null;
  isCurrentEmpty: boolean;
}

export interface ElementLoopRule {
  when: {
    event: ElementLoopEvent;
    currentTypes?: ScreenplayElementType[];
    previousTypes?: string[];
    isCurrentEmpty?: boolean;
  };
  nextType: ScreenplayElementType;
}

export interface ElementLoopProvider {
  id: string;
  title?: string;
  priority?: number;
  stopOnMatch?: boolean;
  rules: ElementLoopRule[];
}

export interface PluginCommandContext {
  document: JSONContent;
  metadata?: Record<string, unknown>;
}

export interface PluginCommand {
  id: string;
  title: string;
  shortcut?: string;
  handler: (context: PluginCommandContext) => void | Promise<void>;
}

export interface RegisteredPluginCommand {
  id: string;
  pluginId: string;
  title: string;
  shortcut?: string;
}

export type DocumentTransformHook = 'post-open' | 'pre-save' | 'pre-export';

export interface DocumentTransformContext {
  hook: DocumentTransformHook;
  document: JSONContent;
  format?: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentTransform {
  id: string;
  hook: DocumentTransformHook;
  priority?: number;
  handler: (
    context: DocumentTransformContext
  ) => JSONContent | void | Promise<JSONContent | void>;
}

export interface ExporterContext {
  document: JSONContent;
  title: string | null;
  metadata?: Record<string, unknown>;
}

export type ExporterOutput = string | Uint8Array;

export interface Exporter {
  id: string;
  title: string;
  extension: string;
  mimeType?: string;
  handler: (context: ExporterContext) => ExporterOutput | Promise<ExporterOutput>;
}

export interface RegisteredExporter {
  id: string;
  pluginId: string;
  title: string;
  extension: string;
  mimeType?: string;
}

export interface Importer {
  id: string;
  title: string;
  extensions: string[];
  handler: (input: string) => JSONContent | Promise<JSONContent>;
}

export interface RegisteredImporter {
  id: string;
  pluginId: string;
  title: string;
  extensions: string[];
}

export interface StatusBadgeContext {
  document: JSONContent;
  metadata?: Record<string, unknown>;
}

export interface StatusBadge {
  id: string;
  label: string;
  priority?: number;
  handler: (context: StatusBadgeContext) => string | null | Promise<string | null>;
}

export interface RegisteredStatusBadge {
  id: string;
  pluginId: string;
  label: string;
  priority?: number;
}

export interface RenderedStatusBadge {
  id: string;
  pluginId: string;
  label: string;
  text: string;
  priority: number;
}

export interface PluginApi {
  registerElementLoopProvider(provider: ElementLoopProvider): void;
  registerCommand(command: PluginCommand): void;
  registerDocumentTransform(transform: DocumentTransform): void;
  registerExporter(exporter: Exporter): void;
  registerImporter(importer: Importer): void;
  registerStatusBadge(badge: StatusBadge): void;
  getDocument(): Promise<JSONContent>;
  replaceDocument(next: JSONContent): Promise<void>;
  requestPermission(permission: OptionalPermission): Promise<boolean>;
  hostCall<T>(operation: HostOperation, payload: unknown): Promise<T>;
}

export interface GraineryPlugin {
  setup(api: PluginApi): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface HostInitMessage {
  type: 'host:init';
  pluginId: string;
  manifest: PluginManifest;
  entrySource: string;
}

export interface HostInvokeMessage {
  type: 'host:invoke';
  requestId: string;
  method: 'command' | 'transform' | 'exporter' | 'importer' | 'status';
  id: string;
  payload: unknown;
}

export interface HostResponseMessage {
  type: 'host:response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface HostShutdownMessage {
  type: 'host:shutdown';
}

export type HostToWorkerMessage =
  | HostInitMessage
  | HostInvokeMessage
  | HostResponseMessage
  | HostShutdownMessage;

export interface WorkerReadyMessage {
  type: 'worker:ready';
  pluginId: string;
}

export interface WorkerErrorMessage {
  type: 'worker:error';
  pluginId: string;
  error: string;
}

export interface WorkerRegisterElementLoopMessage {
  type: 'worker:register-element-loop-provider';
  pluginId: string;
  provider: ElementLoopProvider;
}

export interface WorkerRegisterCommandMessage {
  type: 'worker:register-command';
  pluginId: string;
  command: Omit<PluginCommand, 'handler'>;
}

export interface WorkerRegisterTransformMessage {
  type: 'worker:register-transform';
  pluginId: string;
  transform: Omit<DocumentTransform, 'handler'>;
}

export interface WorkerRegisterExporterMessage {
  type: 'worker:register-exporter';
  pluginId: string;
  exporter: Omit<Exporter, 'handler'>;
}

export interface WorkerRegisterImporterMessage {
  type: 'worker:register-importer';
  pluginId: string;
  importer: Omit<Importer, 'handler'>;
}

export interface WorkerRegisterStatusBadgeMessage {
  type: 'worker:register-status-badge';
  pluginId: string;
  badge: Omit<StatusBadge, 'handler'>;
}

export interface WorkerHostRequestMessage {
  type: 'worker:host-request';
  pluginId: string;
  requestId: string;
  operation: HostOperation;
  payload: unknown;
}

export interface WorkerPermissionRequestMessage {
  type: 'worker:permission-request';
  pluginId: string;
  requestId: string;
  permission: OptionalPermission;
}

export interface WorkerResponseMessage {
  type: 'worker:response';
  pluginId: string;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type WorkerToHostMessage =
  | WorkerReadyMessage
  | WorkerErrorMessage
  | WorkerRegisterElementLoopMessage
  | WorkerRegisterCommandMessage
  | WorkerRegisterTransformMessage
  | WorkerRegisterExporterMessage
  | WorkerRegisterImporterMessage
  | WorkerRegisterStatusBadgeMessage
  | WorkerHostRequestMessage
  | WorkerPermissionRequestMessage
  | WorkerResponseMessage;

export interface PluginStateSnapshot {
  installedPlugins: InstalledPlugin[];
  commands: RegisteredPluginCommand[];
  exporters: RegisteredExporter[];
  importers: RegisteredImporter[];
  statusBadges: RegisteredStatusBadge[];
}
