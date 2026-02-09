/// <reference lib="webworker" />

import { nextRequestId, parseHostMessage } from './rpc';
import type {
  DocumentTransform,
  DocumentTransformContext,
  Exporter,
  ExporterContext,
  GraineryPlugin,
  HostOperation,
  HostResponseMessage,
  HostToWorkerMessage,
  Importer,
  PluginApi,
  PluginCommand,
  PluginCommandContext,
  PluginManifest,
  StatusBadge,
  StatusBadgeContext,
} from './types';

const commandHandlers = new Map<string, PluginCommand['handler']>();
const transformHandlers = new Map<string, DocumentTransform['handler']>();
const exporterHandlers = new Map<string, Exporter['handler']>();
const importerHandlers = new Map<string, Importer['handler']>();
const statusBadgeHandlers = new Map<string, StatusBadge['handler']>();

const pendingHostRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }
>();

let currentPluginId = '';
let pluginInstance: GraineryPlugin | null = null;

function postWorkerMessage(message: unknown): void {
  self.postMessage(message);
}

function throwIfInvalidPluginId(): void {
  if (!currentPluginId) {
    throw new Error('Plugin has not been initialized.');
  }
}

function requestHost<T>(operation: HostOperation, payload: unknown): Promise<T> {
  throwIfInvalidPluginId();

  const requestId = nextRequestId('worker-host');

  return new Promise<T>((resolve, reject) => {
    pendingHostRequests.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    postWorkerMessage({
      type: 'worker:host-request',
      pluginId: currentPluginId,
      requestId,
      operation,
      payload,
    });
  });
}

function requestPermission(permission: string): Promise<boolean> {
  throwIfInvalidPluginId();

  const requestId = nextRequestId('worker-permission');

  return new Promise<boolean>((resolve, reject) => {
    pendingHostRequests.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    postWorkerMessage({
      type: 'worker:permission-request',
      pluginId: currentPluginId,
      requestId,
      permission,
    });
  });
}

function createPluginApi(): PluginApi {
  return {
    registerElementLoopProvider(provider) {
      throwIfInvalidPluginId();
      postWorkerMessage({
        type: 'worker:register-element-loop-provider',
        pluginId: currentPluginId,
        provider,
      });
    },
    registerCommand(command) {
      throwIfInvalidPluginId();
      commandHandlers.set(command.id, command.handler);
      postWorkerMessage({
        type: 'worker:register-command',
        pluginId: currentPluginId,
        command: {
          id: command.id,
          title: command.title,
          shortcut: command.shortcut,
        },
      });
    },
    registerDocumentTransform(transform) {
      throwIfInvalidPluginId();
      transformHandlers.set(transform.id, transform.handler);
      postWorkerMessage({
        type: 'worker:register-transform',
        pluginId: currentPluginId,
        transform: {
          id: transform.id,
          hook: transform.hook,
          priority: transform.priority,
        },
      });
    },
    registerExporter(exporter) {
      throwIfInvalidPluginId();
      exporterHandlers.set(exporter.id, exporter.handler);
      postWorkerMessage({
        type: 'worker:register-exporter',
        pluginId: currentPluginId,
        exporter: {
          id: exporter.id,
          title: exporter.title,
          extension: exporter.extension,
          mimeType: exporter.mimeType,
        },
      });
    },
    registerImporter(importer) {
      throwIfInvalidPluginId();
      importerHandlers.set(importer.id, importer.handler);
      postWorkerMessage({
        type: 'worker:register-importer',
        pluginId: currentPluginId,
        importer: {
          id: importer.id,
          title: importer.title,
          extensions: importer.extensions,
        },
      });
    },
    registerStatusBadge(badge) {
      throwIfInvalidPluginId();
      statusBadgeHandlers.set(badge.id, badge.handler);
      postWorkerMessage({
        type: 'worker:register-status-badge',
        pluginId: currentPluginId,
        badge: {
          id: badge.id,
          label: badge.label,
          priority: badge.priority,
        },
      });
    },
    getDocument() {
      return requestHost('document:get', null);
    },
    replaceDocument(next) {
      return requestHost('document:replace', next);
    },
    requestPermission(permission) {
      return requestPermission(permission);
    },
    hostCall(operation, payload) {
      return requestHost(operation, payload);
    },
  };
}

async function loadPlugin(entrySource: string, _manifest: PluginManifest): Promise<void> {
  const blob = new Blob([entrySource], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  try {
    const module = await import(/* @vite-ignore */ url);
    const candidate = module.default ?? module.plugin ?? module;

    if (!candidate || typeof candidate.setup !== 'function') {
      throw new Error('Plugin entry must export a default object with a setup(api) function.');
    }

    pluginInstance = candidate as GraineryPlugin;
    await pluginInstance.setup(createPluginApi());

    postWorkerMessage({
      type: 'worker:ready',
      pluginId: currentPluginId,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleInvokeMessage(message: Extract<HostToWorkerMessage, { type: 'host:invoke' }>): Promise<void> {
  const respond = (ok: boolean, result?: unknown, error?: string) => {
    postWorkerMessage({
      type: 'worker:response',
      pluginId: currentPluginId,
      requestId: message.requestId,
      ok,
      result,
      error,
    });
  };

  try {
    switch (message.method) {
      case 'command': {
        const handler = commandHandlers.get(message.id);
        if (!handler) {
          throw new Error(`Command not found: ${message.id}`);
        }
        await handler(message.payload as PluginCommandContext);
        respond(true, null);
        return;
      }
      case 'transform': {
        const handler = transformHandlers.get(message.id);
        if (!handler) {
          throw new Error(`Transform not found: ${message.id}`);
        }
        const result = await handler(message.payload as DocumentTransformContext);
        respond(true, result ?? null);
        return;
      }
      case 'exporter': {
        const handler = exporterHandlers.get(message.id);
        if (!handler) {
          throw new Error(`Exporter not found: ${message.id}`);
        }
        const result = await handler(message.payload as ExporterContext);

        if (result instanceof Uint8Array) {
          respond(true, Array.from(result));
          return;
        }

        respond(true, result);
        return;
      }
      case 'importer': {
        const handler = importerHandlers.get(message.id);
        if (!handler) {
          throw new Error(`Importer not found: ${message.id}`);
        }
        const result = await handler(String(message.payload ?? ''));
        respond(true, result);
        return;
      }
      case 'status': {
        const handler = statusBadgeHandlers.get(message.id);
        if (!handler) {
          throw new Error(`Status badge handler not found: ${message.id}`);
        }

        const result = await handler(message.payload as StatusBadgeContext);
        respond(true, result ?? null);
        return;
      }
      default:
        throw new Error(`Unsupported invoke method: ${String(message.method)}`);
    }
  } catch (error) {
    respond(false, null, error instanceof Error ? error.message : String(error));
  }
}

async function handleShutdown(): Promise<void> {
  if (pluginInstance?.dispose) {
    await pluginInstance.dispose();
  }

  commandHandlers.clear();
  transformHandlers.clear();
  exporterHandlers.clear();
  importerHandlers.clear();
  statusBadgeHandlers.clear();
  pendingHostRequests.clear();

  self.close();
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  const message = parseHostMessage(event.data);
  if (!message) {
    return;
  }

  if (message.type === 'host:response') {
    const response = message as HostResponseMessage;
    const pending = pendingHostRequests.get(response.requestId);
    if (!pending) {
      return;
    }

    pendingHostRequests.delete(response.requestId);
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    pending.reject(new Error(response.error ?? 'Host request failed'));
    return;
  }

  try {
    switch (message.type) {
      case 'host:init':
        currentPluginId = message.pluginId;
        await loadPlugin(message.entrySource, message.manifest);
        break;
      case 'host:invoke':
        await handleInvokeMessage(message);
        break;
      case 'host:shutdown':
        await handleShutdown();
        break;
      default:
        break;
    }
  } catch (error) {
    postWorkerMessage({
      type: 'worker:error',
      pluginId: currentPluginId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
