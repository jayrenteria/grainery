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
  UIControlDefinition,
  UIControlStateContext,
  UIControlTriggerResult,
  UIEvaluateResponse,
  UIPanelActionContext,
  UIPanelActionResult,
  UIPanelContent,
  UIPanelDefinition,
  UIPanelStateContext,
} from './types';

const commandHandlers = new Map<string, PluginCommand['handler']>();
const transformHandlers = new Map<string, DocumentTransform['handler']>();
const exporterHandlers = new Map<string, Exporter['handler']>();
const importerHandlers = new Map<string, Importer['handler']>();
const statusBadgeHandlers = new Map<string, StatusBadge['handler']>();
const uiControlTriggerHandlers = new Map<
  string,
  NonNullable<UIControlDefinition['onTrigger']>
>();
const uiControlVisibleHandlers = new Map<
  string,
  NonNullable<UIControlDefinition['isVisible']>
>();
const uiControlDisabledHandlers = new Map<
  string,
  NonNullable<UIControlDefinition['isDisabled']>
>();
const uiControlActiveHandlers = new Map<
  string,
  NonNullable<UIControlDefinition['isActive']>
>();
const uiPanelActionHandlers = new Map<string, NonNullable<UIPanelDefinition['onAction']>>();
const uiPanelRenderHandlers = new Map<string, NonNullable<UIPanelDefinition['onRender']>>();

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
    registerUIControl(control) {
      throwIfInvalidPluginId();

      if (control.onTrigger) {
        uiControlTriggerHandlers.set(control.id, control.onTrigger);
      }
      if (control.isVisible) {
        uiControlVisibleHandlers.set(control.id, control.isVisible);
      }
      if (control.isDisabled) {
        uiControlDisabledHandlers.set(control.id, control.isDisabled);
      }
      if (control.isActive) {
        uiControlActiveHandlers.set(control.id, control.isActive);
      }

      postWorkerMessage({
        type: 'worker:register-ui-control',
        pluginId: currentPluginId,
        control: {
          id: control.id,
          mount: control.mount,
          kind: control.kind,
          label: control.label,
          icon: control.icon,
          priority: control.priority,
          tooltip: control.tooltip,
          group: control.group,
          hotkeyHint: control.hotkeyHint,
          action: control.action,
        },
      });
    },
    registerUIPanel(panel) {
      throwIfInvalidPluginId();

      if (panel.onAction) {
        uiPanelActionHandlers.set(panel.id, panel.onAction);
      }
      if (panel.onRender) {
        uiPanelRenderHandlers.set(panel.id, panel.onRender);
      }

      postWorkerMessage({
        type: 'worker:register-ui-panel',
        pluginId: currentPluginId,
        panel: {
          id: panel.id,
          title: panel.title,
          icon: panel.icon,
          defaultWidth: panel.defaultWidth,
          minWidth: panel.minWidth,
          maxWidth: panel.maxWidth,
          priority: panel.priority,
          content: panel.content,
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

async function evaluateUIState(
  controlIds: string[],
  panelIds: string[],
  context: UIControlStateContext
): Promise<UIEvaluateResponse> {
  const controls: Record<string, { visible: boolean; disabled: boolean; active: boolean; text?: string | null }> = {};
  const panels: Record<string, UIPanelContent> = {};

  for (const controlId of controlIds) {
    const visibleHandler = uiControlVisibleHandlers.get(controlId);
    const disabledHandler = uiControlDisabledHandlers.get(controlId);
    const activeHandler = uiControlActiveHandlers.get(controlId);

    const visible = visibleHandler ? Boolean(await visibleHandler(context)) : true;
    const disabled = disabledHandler ? Boolean(await disabledHandler(context)) : false;
    const active = activeHandler ? Boolean(await activeHandler(context)) : false;

    controls[controlId] = {
      visible,
      disabled,
      active,
      text: null,
    };
  }

  const panelContext: UIPanelStateContext = {
    document: context.document,
    currentElementType: context.currentElementType,
    metadata: context.metadata,
  };

  for (const panelId of panelIds) {
    const renderHandler = uiPanelRenderHandlers.get(panelId);
    if (!renderHandler) {
      continue;
    }

    const content = await renderHandler(panelContext);
    if (content) {
      panels[panelId] = content;
    }
  }

  return {
    controls,
    panels,
  };
}

async function handleInvokeMessage(
  message: Extract<HostToWorkerMessage, { type: 'host:invoke' }>
): Promise<void> {
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
      case 'ui-control': {
        const handler = uiControlTriggerHandlers.get(message.id);
        if (!handler) {
          respond(true, { action: null } satisfies UIControlTriggerResult);
          return;
        }

        const result = await handler(message.payload as UIControlStateContext);
        respond(true, result ?? { action: null } satisfies UIControlTriggerResult);
        return;
      }
      case 'ui-panel-action': {
        const handler = uiPanelActionHandlers.get(message.id);
        if (!handler) {
          respond(true, { action: null } satisfies UIPanelActionResult);
          return;
        }

        const result = await handler(message.payload as UIPanelActionContext);
        respond(true, result ?? { action: null } satisfies UIPanelActionResult);
        return;
      }
      case 'ui-evaluate': {
        const payload = message.payload as {
          controlIds: string[];
          panelIds: string[];
          context: UIControlStateContext;
        };

        const evaluated = await evaluateUIState(
          payload.controlIds ?? [],
          payload.panelIds ?? [],
          payload.context
        );

        respond(true, evaluated);
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
  uiControlTriggerHandlers.clear();
  uiControlVisibleHandlers.clear();
  uiControlDisabledHandlers.clear();
  uiControlActiveHandlers.clear();
  uiPanelActionHandlers.clear();
  uiPanelRenderHandlers.clear();
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
