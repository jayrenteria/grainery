import { invoke } from '@tauri-apps/api/core';
import type { JSONContent } from '@tiptap/react';
import type { ScreenplayElementType } from '../lib/types';
import { hasPluginPermission } from './permissions';
import { nextRequestId, parseWorkerMessage } from './rpc';
import { PluginHost } from './PluginHost';
import {
  assertContributedId,
  assertValidLocalId,
  normalizeInlineAnnotationsWithLimit,
  validatePanelContent,
  validateUiAction,
  validateUiControlDefinition,
  validateUiPanelDefinition,
} from './validation';
import type {
  ContributedTransform,
  DocumentTransformContext,
  DocumentTransformHook,
  ElementLoopContext,
  ElementLoopProvider,
  HostToWorkerMessage,
  InlineAnnotation,
  InlineAnnotationContext,
  InstalledPlugin,
  OptionalPermission,
  PluginContributions,
  PluginLockRecord,
  PluginPermissionGrant,
  PluginRegistryEntry,
  PluginStateSnapshot,
  RegisteredExporter,
  RegisteredImporter,
  RegisteredPluginCommand,
  RegisteredStatusBadge,
  RegisteredUIControl,
  RegisteredUIPanel,
  RegisteredInlineAnnotationProvider,
  RenderedInlineAnnotation,
  RenderedStatusBadge,
  UIControlAction,
  UIControlState,
  UIControlStateContext,
  UIControlTriggerResult,
  UIEvaluateResponse,
  UIPanelActionResult,
  UIPanelContent,
} from './types';

interface PendingInvoke {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface WorkerSession {
  worker: Worker;
  pluginId: string;
  ready: boolean;
  shuttingDown: boolean;
  pending: Map<string, PendingInvoke>;
}

interface RegisteredLoopProvider {
  pluginId: string;
  provider: ElementLoopProvider;
}

interface RegisteredTransform {
  pluginId: string;
  id: string;
  hook: DocumentTransformHook;
  priority: number;
}

type ActivationState = 'inactive' | 'activating' | 'active' | 'failed';

interface ManifestContributionIndex {
  commands: Set<string>;
  exporters: Set<string>;
  importers: Set<string>;
  statusBadges: Set<string>;
  inlineAnnotationProviders: Set<string>;
  uiControls: Set<string>;
  uiPanels: Set<string>;
  transforms: Set<string>;
}

interface PluginManagerOptions {
  getDocument: () => JSONContent;
  replaceDocument: (next: JSONContent) => void | Promise<void>;
  getPluginData: (pluginId: string) => unknown | null;
  setPluginData: (pluginId: string, value: unknown) => void | Promise<void>;
}

const MAX_CRASH_COUNT = 3;
const INVOKE_TIMEOUT_MS = 8_000;

export class PluginManager {
  private readonly pluginHost: PluginHost;
  private readonly sessions = new Map<string, WorkerSession>();
  private readonly listeners = new Set<() => void>();
  private readonly crashCounts = new Map<string, number>();

  private installedPlugins: InstalledPlugin[] = [];
  private loopProviders: RegisteredLoopProvider[] = [];
  private commands: RegisteredPluginCommand[] = [];
  private transforms: RegisteredTransform[] = [];
  private exporters: RegisteredExporter[] = [];
  private importers: RegisteredImporter[] = [];
  private statusBadges: RegisteredStatusBadge[] = [];
  private inlineAnnotationProviders: RegisteredInlineAnnotationProvider[] = [];
  private uiControls: RegisteredUIControl[] = [];
  private uiPanels: RegisteredUIPanel[] = [];
  private activationStates = new Map<string, ActivationState>();
  private activationPromises = new Map<string, Promise<void>>();
  private contributionsByPlugin = new Map<string, ManifestContributionIndex>();

  constructor(options: PluginManagerOptions) {
    this.pluginHost = new PluginHost({
      getDocument: options.getDocument,
      replaceDocument: options.replaceDocument,
      getPluginData: options.getPluginData,
      setPluginData: options.setPluginData,
    });
  }

  updateDocumentAccess(options: PluginManagerOptions): void {
    this.pluginHost.updateDocumentAccess(options);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): PluginStateSnapshot {
    return {
      installedPlugins: [...this.installedPlugins],
      commands: [...this.commands],
      exporters: [...this.exporters],
      importers: [...this.importers],
      statusBadges: [...this.statusBadges],
      inlineAnnotationProviders: [...this.inlineAnnotationProviders],
      uiControls: [...this.uiControls],
      uiPanels: [...this.uiPanels],
    };
  }

  getInstalledPlugins(): InstalledPlugin[] {
    return [...this.installedPlugins];
  }

  getCommands(): RegisteredPluginCommand[] {
    return [...this.commands];
  }

  getExporters(): RegisteredExporter[] {
    return [...this.exporters];
  }

  getImporters(): RegisteredImporter[] {
    return [...this.importers];
  }

  getStatusBadges(): RegisteredStatusBadge[] {
    return [...this.statusBadges];
  }

  getUIControls(mount?: RegisteredUIControl['mount']): RegisteredUIControl[] {
    const filtered = this.uiControls.filter((control) => {
      const plugin = this.getPluginById(control.pluginId);
      if (!plugin) {
        return false;
      }

      if (!hasPluginPermission(plugin, 'ui:mount')) {
        return false;
      }

      return mount ? control.mount === mount : true;
    });

    return [...filtered].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pb !== pa) {
        return pb - pa;
      }
      return a.id.localeCompare(b.id);
    });
  }

  getUIPanels(): RegisteredUIPanel[] {
    const filtered = this.uiPanels.filter((panel) => {
      const plugin = this.getPluginById(panel.pluginId);
      return Boolean(plugin && hasPluginPermission(plugin, 'ui:mount'));
    });

    return [...filtered].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pb !== pa) {
        return pb - pa;
      }
      return a.id.localeCompare(b.id);
    });
  }

  async initialize(): Promise<void> {
    await this.reloadInstalledPlugins();
  }

  async reloadInstalledPlugins(): Promise<void> {
    const installed = await invoke<InstalledPlugin[]>('plugin_list_installed');

    await this.disposeAllWorkers();

    this.installedPlugins = installed;
    this.loopProviders = [];
    this.commands = [];
    this.transforms = [];
    this.exporters = [];
    this.importers = [];
    this.statusBadges = [];
    this.inlineAnnotationProviders = [];
    this.uiControls = [];
    this.uiPanels = [];
    this.activationStates.clear();
    this.activationPromises.clear();
    this.contributionsByPlugin.clear();

    const enabled = this.installedPlugins.filter((plugin) => plugin.enabled);

    for (const plugin of enabled) {
      this.indexManifestContributions(plugin);
      this.activationStates.set(plugin.id, 'inactive');

      const shouldStartupActivate = plugin.manifest.activationEvents.includes('onStartup');
      if (shouldStartupActivate) {
        void this.ensureActivated(plugin.id, 'onStartup').catch((error) => {
          console.error(`[PluginManager] Startup activation failed for ${plugin.id}`, error);
        });
      }
    }

    this.notifyListeners();
  }

  async installFromFile(path: string): Promise<InstalledPlugin> {
    const plugin = await invoke<InstalledPlugin>('plugin_install_from_file', { path });
    await this.reloadInstalledPlugins();
    return plugin;
  }

  async fetchRegistryIndex(registryUrl: string): Promise<PluginRegistryEntry[]> {
    return invoke<PluginRegistryEntry[]>('plugin_fetch_registry_index', { registryUrl });
  }

  async installFromRegistry(
    registryUrl: string,
    pluginId: string,
    version: string | null
  ): Promise<InstalledPlugin> {
    const plugin = await invoke<InstalledPlugin>('plugin_install_from_registry', {
      registryUrl,
      pluginId,
      version,
    });

    await this.reloadInstalledPlugins();
    return plugin;
  }

  async uninstall(pluginId: string): Promise<void> {
    await invoke('plugin_uninstall', { pluginId });
    await this.reloadInstalledPlugins();
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    await invoke<InstalledPlugin>('plugin_enable_disable', { pluginId, enabled });
    await this.reloadInstalledPlugins();
  }

  async updatePermissions(
    pluginId: string,
    permissions: PluginPermissionGrant[]
  ): Promise<InstalledPlugin> {
    const updated = await invoke<InstalledPlugin>('plugin_update_permissions', {
      pluginId,
      permissions,
    });

    await this.reloadInstalledPlugins();
    return updated;
  }

  async getLockRecords(): Promise<PluginLockRecord[]> {
    return invoke<PluginLockRecord[]>('plugin_get_lock_records');
  }

  resolveElementLoop(context: ElementLoopContext): ScreenplayElementType | null {
    const providers = [...this.loopProviders].sort((a, b) => {
      const aPriority = a.provider.priority ?? 0;
      const bPriority = b.provider.priority ?? 0;
      return bPriority - aPriority;
    });

    for (const { provider } of providers) {
      for (const rule of provider.rules) {
        if (rule.when.event !== context.event) {
          continue;
        }

        if (rule.when.currentTypes && !rule.when.currentTypes.includes(context.currentType)) {
          continue;
        }

        if (
          rule.when.previousTypes &&
          !rule.when.previousTypes.includes(context.previousType ?? '')
        ) {
          continue;
        }

        if (
          typeof rule.when.isCurrentEmpty === 'boolean' &&
          rule.when.isCurrentEmpty !== context.isCurrentEmpty
        ) {
          continue;
        }

        return rule.nextType;
      }
    }

    return null;
  }

  async executeCommand(commandId: string, metadata?: Record<string, unknown>): Promise<void> {
    const [pluginId, localId] = splitCompositeId(commandId);
    if (!pluginId || !localId) {
      throw new Error(`Invalid command id: ${commandId}`);
    }

    const plugin = this.getPluginById(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not installed: ${pluginId}`);
    }

    if (!hasPluginPermission(plugin, 'document:read')) {
      throw new Error(`Plugin ${pluginId} does not have document:read permission`);
    }

    await this.ensureActivated(pluginId, `onCommand:${localId}`);
    await this.invokeWorker(pluginId, 'command', localId, {
      document: this.pluginHost.readDocument(),
      metadata,
    });
  }

  async maybeExecuteShortcut(event: KeyboardEvent): Promise<boolean> {
    const shortcut = normalizeKeyboardShortcut(event);
    if (!shortcut) {
      return false;
    }

    const command = this.commands.find(
      (item) => normalizeDeclaredShortcut(item.shortcut) === shortcut
    );
    if (!command) {
      return false;
    }

    event.preventDefault();
    await this.executeCommand(command.id, {
      source: 'shortcut',
    });
    return true;
  }

  async runDocumentTransforms(
    hook: DocumentTransformHook,
    document: JSONContent,
    metadata?: Record<string, unknown>
  ): Promise<JSONContent> {
    const ordered = this.transforms
      .filter((item) => item.hook === hook)
      .sort((a, b) => b.priority - a.priority);

    let current = document;

    for (const transform of ordered) {
      try {
        await this.ensureActivated(transform.pluginId, `onTransform:${transform.hook}`);
        const result = await this.invokeWorker(transform.pluginId, 'transform', transform.id, {
          hook,
          document: current,
          metadata,
        } satisfies DocumentTransformContext);

        if (isJsonContent(result)) {
          current = result;
        }
      } catch (error) {
        console.error(
          `[PluginManager] Transform failed: ${transform.pluginId}:${transform.id}`,
          error
        );
      }
    }

    return current;
  }

  async runExporter(
    exporterId: string,
    context: { document: JSONContent; title: string | null; metadata?: Record<string, unknown> }
  ): Promise<string | Uint8Array> {
    const [pluginId, localId] = splitCompositeId(exporterId);
    if (!pluginId || !localId) {
      throw new Error(`Invalid exporter id: ${exporterId}`);
    }

    await this.ensureActivated(pluginId, `onExporter:${localId}`);
    const result = await this.invokeWorker(pluginId, 'exporter', localId, {
      document: context.document,
      title: context.title,
      metadata: context.metadata,
    });

    if (Array.isArray(result)) {
      return new Uint8Array(result.map((value) => Number(value)));
    }

    if (typeof result === 'string') {
      return result;
    }

    throw new Error(`Exporter ${exporterId} returned an unsupported output type.`);
  }

  async runImporter(importerId: string, input: string): Promise<JSONContent> {
    const [pluginId, localId] = splitCompositeId(importerId);
    if (!pluginId || !localId) {
      throw new Error(`Invalid importer id: ${importerId}`);
    }

    await this.ensureActivated(pluginId, `onImporter:${localId}`);
    const result = await this.invokeWorker(pluginId, 'importer', localId, input);

    if (!isJsonContent(result)) {
      throw new Error(`Importer ${importerId} returned invalid content.`);
    }

    return result;
  }

  async evaluateStatusBadges(
    context: { document: JSONContent; metadata?: Record<string, unknown> }
  ): Promise<RenderedStatusBadge[]> {
    const badges = [...this.statusBadges].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const rendered: RenderedStatusBadge[] = [];

    for (const badge of badges) {
      try {
        await this.ensureActivated(badge.pluginId, `onStatusBadge:${getLocalId(badge.id)}`);
        const value = await this.invokeWorker(badge.pluginId, 'status', getLocalId(badge.id), {
          document: context.document,
          metadata: context.metadata,
        });

        if (typeof value === 'string' && value.trim().length > 0) {
          rendered.push({
            id: badge.id,
            pluginId: badge.pluginId,
            label: badge.label,
            text: value.trim(),
            priority: badge.priority ?? 0,
          });
        }
      } catch (error) {
        console.error(`[PluginManager] Status badge failed: ${badge.id}`, error);
      }
    }

    return rendered;
  }

  async evaluateInlineAnnotations(
    context: InlineAnnotationContext
  ): Promise<RenderedInlineAnnotation[]> {
    const providers = [...this.inlineAnnotationProviders].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
    const maxPosition = Math.max(1, getDocumentContentSize(context.document));
    const jobs = providers.map(async (provider) => {
      const plugin = this.getPluginById(provider.pluginId);
      if (!plugin || !plugin.enabled) {
        return [] as RenderedInlineAnnotation[];
      }

      if (!hasPluginPermission(plugin, 'document:read')) {
        return [] as RenderedInlineAnnotation[];
      }

      if (!hasPluginPermission(plugin, 'editor:annotations')) {
        return [] as RenderedInlineAnnotation[];
      }

      try {
        await this.ensureActivated(
          provider.pluginId,
          `onInlineAnnotations:${getLocalId(provider.id)}`
        );
        const response = await this.invokeWorker(
          provider.pluginId,
          'inline-annotations',
          getLocalId(provider.id),
          context
        );

        const candidate = Array.isArray(response) ? (response as InlineAnnotation[]) : [];
        const annotations = normalizeInlineAnnotationsWithLimit(candidate);
        const priority = provider.priority ?? 0;

        const normalized: RenderedInlineAnnotation[] = [];
        for (const annotation of annotations) {
          const item = normalizeInlineAnnotation(provider.pluginId, annotation, maxPosition, priority);
          if (item) {
            normalized.push(item);
          }
        }

        return normalized;
      } catch (error) {
        console.error(
          `[PluginManager] Inline annotation provider failed: ${provider.id}`,
          error
        );
        return [] as RenderedInlineAnnotation[];
      }
    });

    const settled = await Promise.allSettled(jobs);
    const rendered: RenderedInlineAnnotation[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        rendered.push(...result.value);
      }
    }

    return rendered;
  }

  async evaluateUIState(
    controlIds: string[],
    panelIds: string[],
    context: UIControlStateContext
  ): Promise<{ controls: Record<string, UIControlState>; panels: Record<string, UIPanelContent> }> {
    const controls: Record<string, UIControlState> = {};
    const panels: Record<string, UIPanelContent> = {};

    const pluginToControlIds = new Map<string, string[]>();
    const pluginToPanelIds = new Map<string, string[]>();

    for (const controlId of controlIds) {
      const [pluginId, localId] = splitCompositeId(controlId);
      if (!pluginId || !localId) continue;

      const plugin = this.getPluginById(pluginId);
      if (!plugin || !hasPluginPermission(plugin, 'ui:mount')) continue;

      const next = pluginToControlIds.get(pluginId) ?? [];
      next.push(localId);
      pluginToControlIds.set(pluginId, next);
    }

    for (const panelId of panelIds) {
      const [pluginId, localId] = splitCompositeId(panelId);
      if (!pluginId || !localId) continue;

      const plugin = this.getPluginById(pluginId);
      if (!plugin || !hasPluginPermission(plugin, 'ui:mount')) continue;

      const next = pluginToPanelIds.get(pluginId) ?? [];
      next.push(localId);
      pluginToPanelIds.set(pluginId, next);
    }

    for (const [pluginId, localControlIds] of pluginToControlIds.entries()) {
      const session = this.sessions.get(pluginId);
      if (!session || !session.ready) {
        continue;
      }

      try {
        const localPanelIds = pluginToPanelIds.get(pluginId) ?? [];

        const result = (await this.invokeWorker(pluginId, 'ui-evaluate', '__batch__', {
          controlIds: localControlIds,
          panelIds: localPanelIds,
          context,
        })) as UIEvaluateResponse;

        for (const localControlId of localControlIds) {
          const globalId = composeId(pluginId, localControlId);
          controls[globalId] = result.controls?.[localControlId] ?? {
            visible: true,
            disabled: false,
            active: false,
            text: null,
          };
        }

        for (const localPanelId of localPanelIds) {
          const globalId = composeId(pluginId, localPanelId);
          const panel = this.uiPanels.find((candidate) => candidate.id === globalId);
          if (result.panels?.[localPanelId]) {
            panels[globalId] = result.panels[localPanelId];
          } else if (panel?.content) {
            panels[globalId] = panel.content;
          }
        }
      } catch (error) {
        console.error(`[PluginManager] UI evaluate failed for plugin ${pluginId}`, error);
      }
    }

    for (const panelId of panelIds) {
      if (panels[panelId]) {
        continue;
      }

      const panel = this.uiPanels.find((candidate) => candidate.id === panelId);
      if (panel?.content) {
        panels[panelId] = panel.content;
      }
    }

    return { controls, panels };
  }

  async triggerUIControl(
    controlId: string,
    context: UIControlStateContext
  ): Promise<UIControlAction | null> {
    const control = this.uiControls.find((item) => item.id === controlId);
    if (!control) {
      throw new Error(`UI control not found: ${controlId}`);
    }

    const plugin = this.getPluginById(control.pluginId);
    if (!plugin || !hasPluginPermission(plugin, 'ui:mount')) {
      return null;
    }

    await this.ensureActivated(control.pluginId, `onUIControl:${getLocalId(control.id)}`);
    const result = (await this.invokeWorker(
      control.pluginId,
      'ui-control',
      getLocalId(control.id),
      context
    )) as UIControlTriggerResult;

    const action = result?.action ?? control.action ?? null;
    return normalizeUiAction(control.pluginId, action);
  }

  async dispatchUIPanelAction(
    panelId: string,
    actionId: string,
    context: UIControlStateContext,
    formValues: Record<string, string>
  ): Promise<UIPanelActionResult> {
    const panel = this.uiPanels.find((item) => item.id === panelId);
    if (!panel) {
      throw new Error(`UI panel not found: ${panelId}`);
    }

    const plugin = this.getPluginById(panel.pluginId);
    if (!plugin || !hasPluginPermission(plugin, 'ui:mount')) {
      return { action: null };
    }

    await this.ensureActivated(panel.pluginId, `onUIPanel:${getLocalId(panel.id)}`);
    const response = (await this.invokeWorker(panel.pluginId, 'ui-panel-action', getLocalId(panel.id), {
      document: context.document,
      currentElementType: context.currentElementType,
      selectionFrom: context.selectionFrom,
      selectionTo: context.selectionTo,
      metadata: context.metadata,
      actionId,
      formValues,
    })) as UIPanelActionResult;

    const normalizedAction = normalizeUiAction(panel.pluginId, response?.action ?? null);
    return {
      ...(response ?? {}),
      action: normalizedAction,
    };
  }

  async activateUIPanel(panelId: string): Promise<void> {
    const [pluginId, localId] = splitCompositeId(panelId);
    if (!pluginId || !localId) {
      throw new Error(`Invalid panel id: ${panelId}`);
    }

    const panel = this.uiPanels.find((item) => item.id === panelId);
    if (!panel) {
      throw new Error(`UI panel not found: ${panelId}`);
    }

    const plugin = this.getPluginById(pluginId);
    if (!plugin || !hasPluginPermission(plugin, 'ui:mount')) {
      return;
    }

    await this.ensureActivated(pluginId, `onUIPanel:${localId}`);
  }

  private indexManifestContributions(plugin: InstalledPlugin): void {
    const contributes = normalizeManifestContributions(plugin.manifest.contributes);
    const index: ManifestContributionIndex = {
      commands: new Set(contributes.commands.map((item) => item.id)),
      exporters: new Set(contributes.exporters.map((item) => item.id)),
      importers: new Set(contributes.importers.map((item) => item.id)),
      statusBadges: new Set(contributes.statusBadges.map((item) => item.id)),
      inlineAnnotationProviders: new Set(contributes.inlineAnnotationProviders.map((item) => item.id)),
      uiControls: new Set(contributes.uiControls.map((item) => item.id)),
      uiPanels: new Set(contributes.uiPanels.map((item) => item.id)),
      transforms: new Set(contributes.transforms.map((item) => item.id)),
    };

    this.contributionsByPlugin.set(plugin.id, index);

    for (const command of contributes.commands) {
      assertValidLocalId(command.id, 'Command');
      this.commands.push({
        id: composeId(plugin.id, command.id),
        pluginId: plugin.id,
        title: command.title,
        shortcut: command.shortcut,
      });
    }

    for (const exporter of contributes.exporters) {
      assertValidLocalId(exporter.id, 'Exporter');
      this.exporters.push({
        id: composeId(plugin.id, exporter.id),
        pluginId: plugin.id,
        title: exporter.title,
        extension: exporter.extension,
        mimeType: exporter.mimeType,
      });
    }

    for (const importer of contributes.importers) {
      assertValidLocalId(importer.id, 'Importer');
      this.importers.push({
        id: composeId(plugin.id, importer.id),
        pluginId: plugin.id,
        title: importer.title,
        extensions: importer.extensions,
      });
    }

    for (const badge of contributes.statusBadges) {
      assertValidLocalId(badge.id, 'Status badge');
      this.statusBadges.push({
        id: composeId(plugin.id, badge.id),
        pluginId: plugin.id,
        label: badge.label,
        priority: badge.priority,
      });
    }

    for (const provider of contributes.inlineAnnotationProviders) {
      assertValidLocalId(provider.id, 'Inline annotation provider');
      this.inlineAnnotationProviders.push({
        id: composeId(plugin.id, provider.id),
        pluginId: plugin.id,
        title: provider.title,
        priority: provider.priority,
      });
    }

    for (const control of contributes.uiControls) {
      validateUiControlDefinition(control);
      if (control.action) {
        validateUiAction(control.action, `UI control '${control.id}'`);
      }
      this.uiControls.push({
        id: composeId(plugin.id, control.id),
        pluginId: plugin.id,
        mount: control.mount,
        kind: control.kind,
        label: control.label,
        icon: control.icon,
        priority: control.priority,
        tooltip: control.tooltip,
        group: control.group,
        hotkeyHint: control.hotkeyHint,
        action: control.action,
        when: control.when,
      });
    }

    for (const panel of contributes.uiPanels) {
      validateUiPanelDefinition(panel);
      if (panel.content) {
        validatePanelContent(panel.content, `UI panel '${panel.id}'`);
      }
      this.uiPanels.push({
        id: composeId(plugin.id, panel.id),
        pluginId: plugin.id,
        title: panel.title,
        icon: panel.icon,
        defaultWidth: panel.defaultWidth,
        minWidth: panel.minWidth,
        maxWidth: panel.maxWidth,
        priority: panel.priority,
        content: panel.content,
        when: panel.when,
      });
    }

    for (const transform of contributes.transforms) {
      assertValidLocalId(transform.id, 'Transform');
      this.transforms.push({
        pluginId: plugin.id,
        id: transform.id,
        hook: transform.hook,
        priority: transform.priority ?? 0,
      });
    }
  }

  private async ensureActivated(pluginId: string, activationEvent: string): Promise<void> {
    const plugin = this.getPluginById(pluginId);
    if (!plugin || !plugin.enabled) {
      throw new Error(`Plugin not enabled: ${pluginId}`);
    }

    const existingSession = this.sessions.get(pluginId);
    if (existingSession?.ready) {
      this.activationStates.set(pluginId, 'active');
      return;
    }

    const state = this.activationStates.get(pluginId);
    if (state === 'failed') {
      throw new Error(`Plugin activation is in failed state: ${pluginId}`);
    }

    const declaredEvents = plugin.manifest.activationEvents as string[];
    const allowsActivation =
      declaredEvents.includes('onStartup') ||
      declaredEvents.includes(activationEvent);
    if (!allowsActivation) {
      throw new Error(
        `Plugin ${pluginId} does not declare activation event '${activationEvent}'`
      );
    }

    const pending = this.activationPromises.get(pluginId);
    if (pending) {
      await pending;
      return;
    }

    if (!plugin.entrySource) {
      throw new Error(`Plugin entry is not available: ${pluginId}`);
    }

    const promise = (async () => {
      this.activationStates.set(pluginId, 'activating');
      if (!this.sessions.has(pluginId)) {
        this.startWorker(plugin);
      }

      await this.waitForWorkerReady(pluginId);
      this.activationStates.set(pluginId, 'active');
    })();

    this.activationPromises.set(pluginId, promise);

    try {
      await promise;
    } catch (error) {
      this.activationStates.set(pluginId, 'failed');
      throw error;
    } finally {
      this.activationPromises.delete(pluginId);
      this.notifyListeners();
    }
  }

  private async waitForWorkerReady(pluginId: string): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < INVOKE_TIMEOUT_MS) {
      const session = this.sessions.get(pluginId);
      if (!session) {
        throw new Error(`Plugin worker unavailable during activation: ${pluginId}`);
      }

      if (session.ready) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Plugin activation timed out: ${pluginId}`);
  }

  private startWorker(plugin: InstalledPlugin): void {
    const worker = new Worker(new URL('./worker-runtime.ts', import.meta.url), {
      type: 'module',
    });

    const session: WorkerSession = {
      worker,
      pluginId: plugin.id,
      ready: false,
      shuttingDown: false,
      pending: new Map(),
    };

    worker.onmessage = (event: MessageEvent<unknown>) => {
      void this.handleWorkerMessage(plugin.id, event.data);
    };

    worker.onerror = (event) => {
      void this.handleWorkerCrash(plugin.id, event.message || 'Worker crashed');
    };

    worker.onmessageerror = () => {
      void this.handleWorkerCrash(plugin.id, 'Worker message error');
    };

    this.sessions.set(plugin.id, session);

    const initMessage: HostToWorkerMessage = {
      type: 'host:init',
      pluginId: plugin.id,
      manifest: plugin.manifest,
      entrySource: plugin.entrySource ?? '',
    };

    worker.postMessage(initMessage);
  }

  private async handleWorkerMessage(pluginId: string, raw: unknown): Promise<void> {
    const message = parseWorkerMessage(raw);
    if (!message) {
      return;
    }

    switch (message.type) {
      case 'worker:ready': {
        const session = this.sessions.get(pluginId);
        if (session) {
          session.ready = true;
        }
        this.activationStates.set(pluginId, 'active');
        return;
      }

      case 'worker:error': {
        await this.handleWorkerCrash(pluginId, message.error);
        return;
      }

      case 'worker:register-element-loop-provider': {
        this.loopProviders = this.loopProviders
          .filter(
            (item) =>
              `${item.pluginId}:${item.provider.id}` !== `${pluginId}:${message.provider.id}`
          )
          .concat([
            {
              pluginId,
              provider: message.provider,
            },
          ]);
        this.notifyListeners();
        return;
      }

      case 'worker:register-command': {
        try {
          const contributions = this.getContributionIndex(pluginId);
          assertValidLocalId(message.command.id, 'Command');
          assertContributedId(message.command.id, contributions.commands, 'Command');
        } catch (error) {
          await this.handleWorkerCrash(
            pluginId,
            error instanceof Error ? error.message : String(error)
          );
          return;
        }

        const id = composeId(pluginId, message.command.id);
        this.commands = this.commands
          .filter((item) => item.id !== id)
          .concat([
            {
              id,
              pluginId,
              title: message.command.title,
              shortcut: message.command.shortcut,
            },
          ]);
        this.notifyListeners();
        return;
      }

      case 'worker:register-transform': {
        try {
          const contributions = this.getContributionIndex(pluginId);
          assertValidLocalId(message.transform.id, 'Transform');
          assertContributedId(message.transform.id, contributions.transforms, 'Transform');
        } catch (error) {
          await this.handleWorkerCrash(
            pluginId,
            error instanceof Error ? error.message : String(error)
          );
          return;
        }

        const record: RegisteredTransform = {
          pluginId,
          id: message.transform.id,
          hook: message.transform.hook,
          priority: message.transform.priority ?? 0,
        };

        this.transforms = this.transforms
          .filter((item) => !(item.pluginId === pluginId && item.id === record.id))
          .concat([record]);

        return;
      }

      case 'worker:register-exporter': {
        try {
          const contributions = this.getContributionIndex(pluginId);
          assertValidLocalId(message.exporter.id, 'Exporter');
          assertContributedId(message.exporter.id, contributions.exporters, 'Exporter');
        } catch (error) {
          await this.handleWorkerCrash(
            pluginId,
            error instanceof Error ? error.message : String(error)
          );
          return;
        }

        const id = composeId(pluginId, message.exporter.id);
        this.exporters = this.exporters
          .filter((item) => item.id !== id)
          .concat([
            {
              id,
              pluginId,
              title: message.exporter.title,
              extension: message.exporter.extension,
              mimeType: message.exporter.mimeType,
            },
          ]);

        this.notifyListeners();
        return;
      }

      case 'worker:register-importer': {
        try {
          const contributions = this.getContributionIndex(pluginId);
          assertValidLocalId(message.importer.id, 'Importer');
          assertContributedId(message.importer.id, contributions.importers, 'Importer');
        } catch (error) {
          await this.handleWorkerCrash(
            pluginId,
            error instanceof Error ? error.message : String(error)
          );
          return;
        }

        const id = composeId(pluginId, message.importer.id);
        this.importers = this.importers
          .filter((item) => item.id !== id)
          .concat([
            {
              id,
              pluginId,
              title: message.importer.title,
              extensions: message.importer.extensions,
            },
          ]);

        this.notifyListeners();
        return;
      }

      case 'worker:register-status-badge': {
        try {
          const contributions = this.getContributionIndex(pluginId);
          assertValidLocalId(message.badge.id, 'Status badge');
          assertContributedId(message.badge.id, contributions.statusBadges, 'Status badge');
        } catch (error) {
          await this.handleWorkerCrash(
            pluginId,
            error instanceof Error ? error.message : String(error)
          );
          return;
        }

        const id = composeId(pluginId, message.badge.id);
        this.statusBadges = this.statusBadges
          .filter((item) => item.id !== id)
          .concat([
            {
              id,
              pluginId,
              label: message.badge.label,
              priority: message.badge.priority,
            },
          ]);
        this.notifyListeners();
        return;
      }

      case 'worker:register-inline-annotation-provider': {
        try {
          const contributions = this.getContributionIndex(pluginId);
          assertValidLocalId(message.provider.id, 'Inline annotation provider');
          assertContributedId(
            message.provider.id,
            contributions.inlineAnnotationProviders,
            'Inline annotation provider'
          );
        } catch (error) {
          await this.handleWorkerCrash(
            pluginId,
            error instanceof Error ? error.message : String(error)
          );
          return;
        }

        const id = composeId(pluginId, message.provider.id);
        this.inlineAnnotationProviders = this.inlineAnnotationProviders
          .filter((item) => item.id !== id)
          .concat([
            {
              id,
              pluginId,
              title: message.provider.title,
              priority: message.provider.priority,
            },
          ]);
        this.notifyListeners();
        return;
      }

      case 'worker:register-ui-control': {
        try {
          const contributions = this.getContributionIndex(pluginId);
          assertValidLocalId(message.control.id, 'UI control');
          assertContributedId(message.control.id, contributions.uiControls, 'UI control');
          validateUiControlDefinition(message.control);
          if (message.control.action) {
            validateUiAction(message.control.action, `UI control '${message.control.id}'`);
          }
        } catch (error) {
          await this.handleWorkerCrash(
            pluginId,
            error instanceof Error ? error.message : String(error)
          );
          return;
        }

        const id = composeId(pluginId, message.control.id);
        this.uiControls = this.uiControls
          .filter((item) => item.id !== id)
          .concat([
            {
              id,
              pluginId,
              mount: message.control.mount,
              kind: message.control.kind,
              label: message.control.label,
              icon: message.control.icon,
              priority: message.control.priority,
              tooltip: message.control.tooltip,
              group: message.control.group,
              hotkeyHint: message.control.hotkeyHint,
              action: message.control.action,
              when: message.control.when,
            },
          ]);
        this.notifyListeners();
        return;
      }

      case 'worker:register-ui-panel': {
        try {
          const contributions = this.getContributionIndex(pluginId);
          assertValidLocalId(message.panel.id, 'UI panel');
          assertContributedId(message.panel.id, contributions.uiPanels, 'UI panel');
          validateUiPanelDefinition(message.panel);
          if (message.panel.content) {
            validatePanelContent(message.panel.content, `UI panel '${message.panel.id}'`);
          }
        } catch (error) {
          await this.handleWorkerCrash(
            pluginId,
            error instanceof Error ? error.message : String(error)
          );
          return;
        }

        const id = composeId(pluginId, message.panel.id);
        this.uiPanels = this.uiPanels
          .filter((item) => item.id !== id)
          .concat([
            {
              id,
              pluginId,
              title: message.panel.title,
              icon: message.panel.icon,
              defaultWidth: message.panel.defaultWidth,
              minWidth: message.panel.minWidth,
              maxWidth: message.panel.maxWidth,
              priority: message.panel.priority,
              content: message.panel.content,
              when: message.panel.when,
            },
          ]);
        this.notifyListeners();
        return;
      }

      case 'worker:host-request': {
        const plugin = this.getPluginById(pluginId);
        if (!plugin) {
          this.respondToWorker(pluginId, message.requestId, false, null, 'Plugin not found');
          return;
        }

        try {
          const result = await this.pluginHost.handleHostOperation(
            plugin,
            message.operation,
            message.payload
          );
          this.respondToWorker(pluginId, message.requestId, true, result);
        } catch (error) {
          this.respondToWorker(
            pluginId,
            message.requestId,
            false,
            null,
            error instanceof Error ? error.message : String(error)
          );
        }

        return;
      }

      case 'worker:permission-request': {
        const plugin = this.getPluginById(pluginId);
        if (!plugin) {
          this.respondToWorker(pluginId, message.requestId, false, null, 'Plugin not found');
          return;
        }

        try {
          const granted = await this.pluginHost.requestPermission(
            plugin,
            message.permission as OptionalPermission
          );
          this.respondToWorker(pluginId, message.requestId, true, granted);
          this.notifyListeners();
        } catch (error) {
          this.respondToWorker(
            pluginId,
            message.requestId,
            false,
            null,
            error instanceof Error ? error.message : String(error)
          );
        }

        return;
      }

      case 'worker:response': {
        const session = this.sessions.get(pluginId);
        if (!session) {
          return;
        }

        const pending = session.pending.get(message.requestId);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeoutId);
        session.pending.delete(message.requestId);

        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error ?? 'Worker invocation failed'));
        }

        return;
      }

      default:
        return;
    }
  }

  private respondToWorker(
    pluginId: string,
    requestId: string,
    ok: boolean,
    result?: unknown,
    error?: string
  ): void {
    const session = this.sessions.get(pluginId);
    if (!session) {
      return;
    }

    session.worker.postMessage({
      type: 'host:response',
      requestId,
      ok,
      result,
      error,
    } satisfies HostToWorkerMessage);
  }

  private async invokeWorker(
    pluginId: string,
    method:
      | 'command'
      | 'transform'
      | 'exporter'
      | 'importer'
      | 'status'
      | 'inline-annotations'
      | 'ui-control'
      | 'ui-panel-action'
      | 'ui-evaluate',
    id: string,
    payload: unknown
  ): Promise<unknown> {
    const session = this.sessions.get(pluginId);
    if (!session || session.shuttingDown) {
      throw new Error(`Plugin worker not available: ${pluginId}`);
    }

    if (!session.ready) {
      throw new Error(`Plugin worker not ready: ${pluginId}`);
    }

    const requestId = nextRequestId(`host-invoke-${pluginId}`);

    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        session.pending.delete(requestId);
        reject(new Error(`Plugin invocation timed out: ${pluginId}:${id}`));
      }, INVOKE_TIMEOUT_MS);

      session.pending.set(requestId, {
        resolve,
        reject,
        timeoutId,
      });

      session.worker.postMessage({
        type: 'host:invoke',
        requestId,
        method,
        id,
        payload,
      } satisfies HostToWorkerMessage);
    });
  }

  private async handleWorkerCrash(pluginId: string, reason: string): Promise<void> {
    const session = this.sessions.get(pluginId);
    if (!session) {
      return;
    }

    if (session.shuttingDown) {
      return;
    }

    console.error(`[PluginManager] Worker crashed (${pluginId}): ${reason}`);

    session.shuttingDown = true;
    session.worker.terminate();
    this.sessions.delete(pluginId);
    this.activationStates.set(pluginId, 'failed');

    for (const [requestId, pending] of session.pending.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`Plugin worker crashed: ${pluginId}`));
      session.pending.delete(requestId);
    }

    const crashes = (this.crashCounts.get(pluginId) ?? 0) + 1;
    this.crashCounts.set(pluginId, crashes);

    if (crashes >= MAX_CRASH_COUNT) {
      try {
        await invoke('plugin_enable_disable', {
          pluginId,
          enabled: false,
        });
      } catch (error) {
        console.error(`[PluginManager] Failed to auto-disable plugin ${pluginId}`, error);
      }

      await this.reloadInstalledPlugins();
    }
  }

  private async disposeAllWorkers(): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();

    for (const session of sessions) {
      session.shuttingDown = true;

      for (const [requestId, pending] of session.pending.entries()) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error(`Plugin worker disposed: ${session.pluginId}`));
        session.pending.delete(requestId);
      }

      try {
        session.worker.postMessage({ type: 'host:shutdown' } satisfies HostToWorkerMessage);
      } catch {
        // no-op
      }

      session.worker.terminate();
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private getContributionIndex(pluginId: string): ManifestContributionIndex {
    const found = this.contributionsByPlugin.get(pluginId);
    if (found) {
      return found;
    }

    return {
      commands: new Set(),
      exporters: new Set(),
      importers: new Set(),
      statusBadges: new Set(),
      inlineAnnotationProviders: new Set(),
      uiControls: new Set(),
      uiPanels: new Set(),
      transforms: new Set(),
    };
  }

  private getPluginById(pluginId: string): InstalledPlugin | undefined {
    return this.installedPlugins.find((item) => item.id === pluginId);
  }
}

function composeId(pluginId: string, localId: string): string {
  return `${pluginId}:${localId}`;
}

function normalizeManifestContributions(contributes: PluginContributions | undefined): PluginContributions {
  if (!contributes || typeof contributes !== 'object') {
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

  const transforms = Array.isArray(contributes.transforms)
    ? contributes.transforms.filter((transform): transform is ContributedTransform => {
        return Boolean(
          transform
          && typeof transform.id === 'string'
          && (transform.hook === 'post-open'
            || transform.hook === 'pre-save'
            || transform.hook === 'pre-export')
        );
      })
    : [];

  return {
    commands: Array.isArray(contributes.commands) ? contributes.commands : [],
    exporters: Array.isArray(contributes.exporters) ? contributes.exporters : [],
    importers: Array.isArray(contributes.importers) ? contributes.importers : [],
    statusBadges: Array.isArray(contributes.statusBadges) ? contributes.statusBadges : [],
    inlineAnnotationProviders: Array.isArray(contributes.inlineAnnotationProviders)
      ? contributes.inlineAnnotationProviders
      : [],
    uiControls: Array.isArray(contributes.uiControls) ? contributes.uiControls : [],
    uiPanels: Array.isArray(contributes.uiPanels) ? contributes.uiPanels : [],
    transforms,
  };
}

function splitCompositeId(id: string): [string | null, string | null] {
  const index = id.indexOf(':');
  if (index === -1) {
    return [null, null];
  }

  return [id.slice(0, index), id.slice(index + 1)];
}

function getLocalId(id: string): string {
  const [, localId] = splitCompositeId(id);
  if (!localId) {
    throw new Error(`Invalid composite id: ${id}`);
  }
  return localId;
}

function isJsonContent(value: unknown): value is JSONContent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybe = value as { type?: unknown };
  return typeof maybe.type === 'string';
}

function normalizeInlineAnnotation(
  pluginId: string,
  annotation: InlineAnnotation,
  maxPosition: number,
  priority: number
): RenderedInlineAnnotation | null {
  if (!annotation || typeof annotation !== 'object') {
    return null;
  }

  if (typeof annotation.id !== 'string' || annotation.id.trim().length === 0) {
    return null;
  }

  const rawFrom = Number(annotation.from);
  const rawTo = Number(annotation.to);

  if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) {
    return null;
  }

  const from = Math.min(Math.max(Math.floor(rawFrom), 1), maxPosition);
  const to = Math.min(Math.max(Math.floor(rawTo), 1), maxPosition);

  if (to <= from) {
    return null;
  }

  const kind = annotation.kind === 'note-active' ? 'note-active' : 'note';

  return {
    id: composeId(pluginId, annotation.id),
    pluginId,
    from,
    to,
    kind,
    priority,
  };
}

function getNodeSize(node: unknown): number {
  if (!node || typeof node !== 'object') {
    return 0;
  }

  const maybeTextNode = node as { text?: unknown };
  if (typeof maybeTextNode.text === 'string') {
    return maybeTextNode.text.length;
  }

  const maybeContentNode = node as { content?: unknown };
  const children = Array.isArray(maybeContentNode.content) ? maybeContentNode.content : [];
  let size = 2;

  for (const child of children) {
    size += getNodeSize(child);
  }

  return size;
}

function getDocumentContentSize(document: JSONContent): number {
  const content = Array.isArray(document.content) ? document.content : [];
  let size = 0;

  for (const node of content) {
    size += getNodeSize(node);
  }

  return size;
}

function normalizeDeclaredShortcut(shortcut?: string): string | null {
  if (!shortcut) {
    return null;
  }

  return shortcut
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('+');
}

function normalizeKeyboardShortcut(event: KeyboardEvent): string | null {
  const parts: string[] = [];

  if (event.metaKey || event.ctrlKey) {
    parts.push('mod');
  }
  if (event.shiftKey) {
    parts.push('shift');
  }
  if (event.altKey) {
    parts.push('alt');
  }

  const key = event.key.toLowerCase();
  if (!['meta', 'control', 'shift', 'alt'].includes(key)) {
    parts.push(key);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.sort().join('+');
}

function normalizeUiAction(pluginId: string, action: UIControlAction | null): UIControlAction | null {
  if (!action) {
    return null;
  }

  if (action.type === 'command') {
    const commandId = action.commandId.includes(':')
      ? action.commandId
      : composeId(pluginId, action.commandId);
    return {
      ...action,
      commandId,
    };
  }

  if (action.type === 'panel:open' || action.type === 'panel:close' || action.type === 'panel:toggle') {
    const panelId = action.panelId.includes(':')
      ? action.panelId
      : composeId(pluginId, action.panelId);
    return {
      ...action,
      panelId,
    };
  }

  return action;
}
