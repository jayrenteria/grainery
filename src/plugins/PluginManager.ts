import { invoke } from '@tauri-apps/api/core';
import type { JSONContent } from '@tiptap/react';
import { nextRequestId, parseWorkerMessage } from './rpc';
import { PluginHost } from './PluginHost';
import { hasPluginPermission } from './permissions';
import type { ScreenplayElementType } from '../lib/types';
import type {
  DocumentTransformContext,
  DocumentTransformHook,
  ElementLoopContext,
  ElementLoopProvider,
  HostToWorkerMessage,
  InstalledPlugin,
  OptionalPermission,
  PluginLockRecord,
  PluginPermissionGrant,
  PluginRegistryEntry,
  PluginStateSnapshot,
  RegisteredExporter,
  RegisteredImporter,
  RegisteredPluginCommand,
  RegisteredStatusBadge,
  RenderedStatusBadge,
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

interface PluginManagerOptions {
  getDocument: () => JSONContent;
  replaceDocument: (next: JSONContent) => void | Promise<void>;
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

  constructor(options: PluginManagerOptions) {
    this.pluginHost = new PluginHost({
      getDocument: options.getDocument,
      replaceDocument: options.replaceDocument,
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

    const enabled = this.installedPlugins.filter((plugin) => plugin.enabled);

    for (const plugin of enabled) {
      if (!plugin.entrySource) {
        continue;
      }

      this.startWorker(plugin);
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

        if (rule.when.previousTypes && !rule.when.previousTypes.includes(context.previousType ?? '')) {
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
    const plugin = this.installedPlugins.find((item) => item.id === pluginId);
    if (!plugin) {
      throw new Error(`Plugin not installed: ${pluginId}`);
    }
    if (!hasPluginPermission(plugin, 'document:read')) {
      throw new Error(`Plugin ${pluginId} does not have document:read permission`);
    }

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

    const command = this.commands.find((item) => normalizeDeclaredShortcut(item.shortcut) === shortcut);
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

    const result = await this.invokeWorker(pluginId, 'importer', localId, input);

    if (!isJsonContent(result)) {
      throw new Error(`Importer ${importerId} returned invalid content.`);
    }

    return result;
  }

  async evaluateStatusBadges(
    context: { document: JSONContent; metadata?: Record<string, unknown> }
  ): Promise<RenderedStatusBadge[]> {
    const badges = [...this.statusBadges].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
    const rendered: RenderedStatusBadge[] = [];

    for (const badge of badges) {
      try {
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
        return;
      }

      case 'worker:error': {
        await this.handleWorkerCrash(pluginId, message.error);
        return;
      }

      case 'worker:register-element-loop-provider': {
        this.loopProviders = this.loopProviders
          .filter((item) => `${item.pluginId}:${item.provider.id}` !== `${pluginId}:${message.provider.id}`)
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

      case 'worker:host-request': {
        const plugin = this.installedPlugins.find((item) => item.id === pluginId);
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
        const plugin = this.installedPlugins.find((item) => item.id === pluginId);
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
    method: 'command' | 'transform' | 'exporter' | 'importer' | 'status',
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
}

function composeId(pluginId: string, localId: string): string {
  return `${pluginId}:${localId}`;
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
