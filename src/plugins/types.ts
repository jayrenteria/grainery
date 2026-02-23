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
  | 'network:https'
  | 'ui:mount'
  | 'editor:annotations';

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

export type PluginActivationEvent =
  | 'onStartup'
  | `onCommand:${string}`
  | `onExporter:${string}`
  | `onImporter:${string}`
  | `onUIControl:${string}`
  | `onUIPanel:${string}`
  | `onStatusBadge:${string}`
  | `onInlineAnnotations:${string}`
  | `onTransform:${DocumentTransformHook}`;

export interface ContributedCommand {
  id: string;
  title: string;
  shortcut?: string;
}

export interface ContributedExporter {
  id: string;
  title: string;
  extension: string;
  mimeType?: string;
}

export interface ContributedImporter {
  id: string;
  title: string;
  extensions: string[];
}

export interface ContributedStatusBadge {
  id: string;
  label: string;
  priority?: number;
}

export interface ContributedInlineAnnotationProvider {
  id: string;
  title?: string;
  priority?: number;
}

export interface ContributedUIControl {
  id: string;
  mount: UIControlMount;
  kind: UIControlKind;
  label: string;
  icon: BuiltinIconId;
  priority?: number;
  tooltip?: string;
  group?: string;
  hotkeyHint?: string;
  action?: UIControlAction;
  when?: string;
}

export interface ContributedUIPanel {
  id: string;
  title: string;
  icon?: BuiltinIconId;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  priority?: number;
  content?: UIPanelContent;
  when?: string;
}

export interface ContributedTransform {
  id: string;
  hook: DocumentTransformHook;
  priority?: number;
}

export interface PluginContributions {
  commands: ContributedCommand[];
  exporters: ContributedExporter[];
  importers: ContributedImporter[];
  statusBadges: ContributedStatusBadge[];
  inlineAnnotationProviders: ContributedInlineAnnotationProvider[];
  uiControls: ContributedUIControl[];
  uiPanels: ContributedUIPanel[];
  transforms: ContributedTransform[];
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
  activationEvents: PluginActivationEvent[];
  contributes: PluginContributions;
  enabledApiProposals?: string[];
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
  | 'document:get-plugin-data'
  | 'document:set-plugin-data'
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
  handler: (context: DocumentTransformContext) => JSONContent | void | Promise<JSONContent | void>;
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

export type InlineAnnotationKind = 'note' | 'note-active';

export interface InlineAnnotation {
  id: string;
  from: number;
  to: number;
  kind?: InlineAnnotationKind;
}

export interface InlineAnnotationContext {
  document: JSONContent;
  selectionFrom: number;
  selectionTo: number;
  metadata?: Record<string, unknown>;
}

export interface InlineAnnotationProvider {
  id: string;
  title?: string;
  priority?: number;
  handler: (
    context: InlineAnnotationContext
  ) => InlineAnnotation[] | void | Promise<InlineAnnotation[] | void>;
}

export interface RegisteredInlineAnnotationProvider {
  id: string;
  pluginId: string;
  title?: string;
  priority?: number;
}

export interface RenderedInlineAnnotation {
  id: string;
  pluginId: string;
  from: number;
  to: number;
  kind: InlineAnnotationKind;
  priority: number;
}

export type UIControlMount = 'top-bar' | 'bottom-bar';
export type UIControlKind = 'button' | 'toggle' | 'segmented';

export type BuiltinIconId =
  | 'scene-heading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'chevron-left'
  | 'chevron-right'
  | 'panel'
  | 'close'
  | 'settings'
  | 'spark';

export type UIControlAction =
  | { type: 'command'; commandId: string }
  | { type: 'editor:set-element'; elementType: ScreenplayElementType }
  | { type: 'editor:jump-to'; position: number; offsetTop?: number }
  | { type: 'editor:cycle-element'; direction: 'next' | 'prev' }
  | { type: 'editor:escape-to-action' }
  | { type: 'panel:open' | 'panel:close' | 'panel:toggle'; panelId: string };

export interface UIControlStateContext {
  document: JSONContent;
  currentElementType: ScreenplayElementType | null;
  previousElementType: string | null;
  isCurrentEmpty: boolean;
  selectionFrom: number;
  selectionTo: number;
  metadata?: Record<string, unknown>;
}

export interface UIControlState {
  visible: boolean;
  disabled: boolean;
  active: boolean;
  text?: string | null;
}

export interface UIControlTriggerResult {
  action?: UIControlAction | null;
}

export interface UIControlDefinition {
  id: string;
  mount: UIControlMount;
  kind: UIControlKind;
  label: string;
  icon: BuiltinIconId;
  priority?: number;
  tooltip?: string;
  group?: string;
  hotkeyHint?: string;
  action?: UIControlAction;
  when?: string;
  isVisible?: (context: UIControlStateContext) => boolean | Promise<boolean>;
  isDisabled?: (context: UIControlStateContext) => boolean | Promise<boolean>;
  isActive?: (context: UIControlStateContext) => boolean | Promise<boolean>;
  onTrigger?: (context: UIControlStateContext) => UIControlTriggerResult | void | Promise<UIControlTriggerResult | void>;
}

export interface UIPanelActionItem {
  id: string;
  label: string;
  variant?: 'default' | 'primary' | 'outline' | 'ghost';
}

export type UIPanelBlock =
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'keyValue'; items: Array<{ key: string; value: string }> }
  | {
      type: 'input';
      fieldId: string;
      label?: string;
      value?: string;
      placeholder?: string;
      maxLength?: number;
    }
  | {
      type: 'textarea';
      fieldId: string;
      label?: string;
      value?: string;
      placeholder?: string;
      rows?: number;
      maxLength?: number;
    }
  | { type: 'actions'; actions: UIPanelActionItem[] };

export interface UIPanelContent {
  blocks: UIPanelBlock[];
}

export interface UIPanelStateContext {
  document: JSONContent;
  currentElementType: ScreenplayElementType | null;
  selectionFrom: number;
  selectionTo: number;
  metadata?: Record<string, unknown>;
}

export interface UIPanelActionContext extends UIPanelStateContext {
  actionId: string;
  formValues: Record<string, string>;
}

export interface UIPanelActionResult {
  action?: UIControlAction | null;
  content?: UIPanelContent;
}

export interface UIPanelDefinition {
  id: string;
  title: string;
  icon?: BuiltinIconId;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  priority?: number;
  content?: UIPanelContent;
  when?: string;
  onAction?: (context: UIPanelActionContext) => UIPanelActionResult | void | Promise<UIPanelActionResult | void>;
  onRender?: (context: UIPanelStateContext) => UIPanelContent | void | Promise<UIPanelContent | void>;
}

export interface RegisteredUIControl {
  id: string;
  pluginId: string;
  mount: UIControlMount;
  kind: UIControlKind;
  label: string;
  icon: BuiltinIconId;
  priority?: number;
  tooltip?: string;
  group?: string;
  hotkeyHint?: string;
  action?: UIControlAction;
  when?: string;
}

export interface RegisteredUIPanel {
  id: string;
  pluginId: string;
  title: string;
  icon?: BuiltinIconId;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  priority?: number;
  content?: UIPanelContent;
  when?: string;
}

export interface EvaluatedUIControl extends RegisteredUIControl {
  state: UIControlState;
}

export interface EvaluatedUIPanel extends RegisteredUIPanel {
  content: UIPanelContent;
}

export interface UIEvaluateResponse {
  controls: Record<string, UIControlState>;
  panels: Record<string, UIPanelContent>;
}

export interface ProposedPluginApi {}

export interface PluginApi {
  registerElementLoopProvider(provider: ElementLoopProvider): void;
  registerCommand(command: PluginCommand): void;
  registerDocumentTransform(transform: DocumentTransform): void;
  registerExporter(exporter: Exporter): void;
  registerImporter(importer: Importer): void;
  registerStatusBadge(badge: StatusBadge): void;
  registerInlineAnnotationProvider(provider: InlineAnnotationProvider): void;
  registerUIControl(control: UIControlDefinition): void;
  registerUIPanel(panel: UIPanelDefinition): void;
  getDocument(): Promise<JSONContent>;
  replaceDocument(next: JSONContent): Promise<void>;
  getPluginData<T = unknown>(): Promise<T | null>;
  setPluginData(value: unknown): Promise<void>;
  requestPermission(permission: OptionalPermission): Promise<boolean>;
  hostCall<T>(operation: HostOperation, payload: unknown): Promise<T>;
  proposed?: ProposedPluginApi;
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
  method:
    | 'command'
    | 'transform'
    | 'exporter'
    | 'importer'
    | 'status'
    | 'inline-annotations'
    | 'ui-control'
    | 'ui-panel-action'
    | 'ui-evaluate';
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

export interface WorkerRegisterInlineAnnotationProviderMessage {
  type: 'worker:register-inline-annotation-provider';
  pluginId: string;
  provider: Omit<InlineAnnotationProvider, 'handler'>;
}

export interface WorkerRegisterUIControlMessage {
  type: 'worker:register-ui-control';
  pluginId: string;
  control: Omit<UIControlDefinition, 'isVisible' | 'isDisabled' | 'isActive' | 'onTrigger'>;
}

export interface WorkerRegisterUIPanelMessage {
  type: 'worker:register-ui-panel';
  pluginId: string;
  panel: Omit<UIPanelDefinition, 'onAction' | 'onRender'>;
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
  | WorkerRegisterInlineAnnotationProviderMessage
  | WorkerRegisterUIControlMessage
  | WorkerRegisterUIPanelMessage
  | WorkerHostRequestMessage
  | WorkerPermissionRequestMessage
  | WorkerResponseMessage;

export interface PluginStateSnapshot {
  installedPlugins: InstalledPlugin[];
  commands: RegisteredPluginCommand[];
  exporters: RegisteredExporter[];
  importers: RegisteredImporter[];
  statusBadges: RegisteredStatusBadge[];
  inlineAnnotationProviders: RegisteredInlineAnnotationProvider[];
  uiControls: RegisteredUIControl[];
  uiPanels: RegisteredUIPanel[];
}
