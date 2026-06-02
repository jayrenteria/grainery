/// <reference lib="webworker" />

import { nextRequestId, parseHostMessage } from './rpc';
import {
  ScreenplayDocument,
  createScreenplayDocument,
  isScreenplayDocument,
} from './document-helpers';
import type {
  Disposable,
  DocumentTransform,
  DocumentTransformContext,
  Exporter,
  ExporterContext,
  GraineryPlugin,
  HostOperation,
  HostResponseMessage,
  HostToWorkerMessage,
  InlineAnnotation,
  InlineAnnotationContext,
  InlineAnnotationProvider,
  Importer,
  PluginApi,
  PluginStorage,
  PluginCommand,
  PluginCommandContext,
  PluginManifest,
  ProposedPluginApi,
  ScreenplayMutationApi,
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
  WorkerRegistrationKind,
} from './types';

const commandHandlers = new Map<string, PluginCommand['handler']>();
const transformHandlers = new Map<string, DocumentTransform['handler']>();
const exporterHandlers = new Map<string, Exporter['handler']>();
const importerHandlers = new Map<string, Importer['handler']>();
const statusBadgeHandlers = new Map<string, StatusBadge['handler']>();
const inlineAnnotationHandlers = new Map<string, InlineAnnotationProvider['handler']>();
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
const registrationTokens = new Map<string, number>();

let currentPluginId = '';
let pluginInstance: GraineryPlugin | null = null;
let nextRegistrationToken = 0;
const ALLOWED_API_PROPOSALS = new Set<string>([]);

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

function createRegistrationDisposable(
  kind: WorkerRegistrationKind,
  id: string,
  cleanup: () => void
): Disposable {
  const key = `${kind}:${id}`;
  const token = nextRegistrationToken + 1;
  nextRegistrationToken = token;
  registrationTokens.set(key, token);
  let disposed = false;

  return {
    dispose() {
      if (disposed || registrationTokens.get(key) !== token) {
        return;
      }

      disposed = true;
      registrationTokens.delete(key);
      cleanup();
      postWorkerMessage({
        type: 'worker:dispose-registration',
        pluginId: currentPluginId,
        kind,
        id,
      });
    },
  };
}

function createStorage<T>(
  getAll: () => Promise<unknown>,
  setAll: (value: unknown) => Promise<void>,
  keyOrDefault: string | T,
  maybeDefault?: T
): PluginStorage<T> {
  const keyed = typeof keyOrDefault === 'string' && maybeDefault !== undefined;
  const key = keyed ? keyOrDefault : null;
  const defaultValue = (keyed ? maybeDefault : keyOrDefault) as T;

  return {
    async get() {
      const current = await getAll();
      if (!key) {
        return current == null ? defaultValue : (current as T);
      }

      if (!current || typeof current !== 'object') {
        return defaultValue;
      }

      const value = (current as Record<string, unknown>)[key];
      return value === undefined || value === null ? defaultValue : (value as T);
    },
    async set(value) {
      if (!key) {
        await setAll(value);
        return;
      }

      const current = await getAll();
      const next = current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
      next[key] = value;
      await setAll(next);
    },
    async update(updater) {
      const current = await this.get();
      const next = await updater(current);
      await this.set(next);
      return next;
    },
    async clear() {
      if (!key) {
        await setAll(null);
        return;
      }

      const current = await getAll();
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return;
      }

      const next = { ...(current as Record<string, unknown>) };
      delete next[key];
      await setAll(next);
    },
  };
}

function toJsonContent(value: unknown): unknown {
  return isScreenplayDocument(value) ? value.toJSON() : value;
}

function contextFromPayload(payload: unknown): { document: unknown } & Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || !('document' in payload)) {
    throw new Error('Plugin context payload is missing document.');
  }

  return payload as { document: unknown } & Record<string, unknown>;
}

function enrichDocumentContext<T extends { document: unknown } & Record<string, unknown>>(
  payload: T
): T & { screenplay: ScreenplayDocument } {
  const document = payload.document as Parameters<typeof createScreenplayDocument>[0];
  return {
    ...payload,
    screenplay: createScreenplayDocument(document, {
      selectionFrom: Number(payload.selectionFrom),
      selectionTo: Number(payload.selectionTo),
      currentElementType: payload.currentElementType as never,
    }),
  };
}

function enrichContext<T>(payload: unknown): T {
  return enrichDocumentContext(contextFromPayload(payload)) as unknown as T;
}

function createScreenplayApi(): ScreenplayMutationApi {
  const getDocumentData = () => requestHost<unknown | null>('document:get-plugin-data', null);
  const setDocumentData = (value: unknown) =>
    requestHost('document:set-plugin-data', { value }).then(() => undefined);
  const getGlobalData = () => requestHost<unknown | null>('plugin:get-global-data', null);
  const setGlobalData = (value: unknown) =>
    requestHost('plugin:set-global-data', { value }).then(() => undefined);

  return {
    from(document, context) {
      return createScreenplayDocument(document, context);
    },
    async getDocument(context) {
      const document = await requestHost<Parameters<typeof createScreenplayDocument>[0]>('document:get', null);
      return createScreenplayDocument(document, context);
    },
    replaceDocument(next) {
      return requestHost('document:replace', toJsonContent(next)).then(() => undefined);
    },
    async mutate(mutator) {
      const document = await this.getDocument();
      const result = await mutator(document);
      const next = toJsonContent(result ?? document) as Parameters<typeof createScreenplayDocument>[0];
      await requestHost('document:replace', next);
      return next;
    },
    documentStorage<T = unknown>(keyOrDefault: string | T, maybeDefault?: T) {
      return createStorage<T>(getDocumentData, setDocumentData, keyOrDefault, maybeDefault);
    },
    globalStorage<T = unknown>(keyOrDefault: string | T, maybeDefault?: T) {
      return createStorage<T>(getGlobalData, setGlobalData, keyOrDefault, maybeDefault);
    },
  };
}

function createProposedApi(enabledApiProposals: string[] | undefined): ProposedPluginApi | undefined {
  if (!Array.isArray(enabledApiProposals) || enabledApiProposals.length === 0) {
    return undefined;
  }

  const allowed = enabledApiProposals.filter((proposal) => ALLOWED_API_PROPOSALS.has(proposal));
  if (allowed.length === 0) {
    return undefined;
  }

  return {};
}

function createPluginApi(manifest: PluginManifest): PluginApi {
  const proposed = createProposedApi(manifest.enabledApiProposals);
  const screenplay = createScreenplayApi();
  return {
    registerElementLoopProvider(provider) {
      throwIfInvalidPluginId();
      postWorkerMessage({
        type: 'worker:register-element-loop-provider',
        pluginId: currentPluginId,
        provider,
      });
      return createRegistrationDisposable('element-loop-provider', provider.id, () => undefined);
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
          category: command.category,
          shortcut: command.shortcut,
        },
      });
      return createRegistrationDisposable('command', command.id, () => {
        commandHandlers.delete(command.id);
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
      return createRegistrationDisposable('transform', transform.id, () => {
        transformHandlers.delete(transform.id);
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
      return createRegistrationDisposable('exporter', exporter.id, () => {
        exporterHandlers.delete(exporter.id);
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
      return createRegistrationDisposable('importer', importer.id, () => {
        importerHandlers.delete(importer.id);
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
      return createRegistrationDisposable('status-badge', badge.id, () => {
        statusBadgeHandlers.delete(badge.id);
      });
    },
    registerInlineAnnotationProvider(provider) {
      throwIfInvalidPluginId();
      inlineAnnotationHandlers.set(provider.id, provider.handler);
      postWorkerMessage({
        type: 'worker:register-inline-annotation-provider',
        pluginId: currentPluginId,
        provider: {
          id: provider.id,
          title: provider.title,
          priority: provider.priority,
        },
      });
      return createRegistrationDisposable('inline-annotation-provider', provider.id, () => {
        inlineAnnotationHandlers.delete(provider.id);
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
          when: control.when,
        },
      });
      return createRegistrationDisposable('ui-control', control.id, () => {
        uiControlTriggerHandlers.delete(control.id);
        uiControlVisibleHandlers.delete(control.id);
        uiControlDisabledHandlers.delete(control.id);
        uiControlActiveHandlers.delete(control.id);
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
          when: panel.when,
        },
      });
      return createRegistrationDisposable('ui-panel', panel.id, () => {
        uiPanelActionHandlers.delete(panel.id);
        uiPanelRenderHandlers.delete(panel.id);
      });
    },
    getDocument() {
      return requestHost('document:get', null);
    },
    replaceDocument(next) {
      return requestHost('document:replace', next);
    },
    getPluginData<T = unknown>() {
      return requestHost<T | null>('document:get-plugin-data', null);
    },
    setPluginData(value) {
      return requestHost('document:set-plugin-data', { value }).then(() => undefined);
    },
    screenplay,
    requestPermission(permission) {
      return requestPermission(permission);
    },
    hostCall(operation, payload) {
      return requestHost(operation, payload);
    },
    proposed,
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
    await pluginInstance.setup(createPluginApi(_manifest));

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
    screenplay: context.screenplay,
    documentMode: context.documentMode,
    currentElementType: context.currentElementType,
    selectionFrom: context.selectionFrom,
    selectionTo: context.selectionTo,
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
        await handler(enrichContext<PluginCommandContext>(message.payload));
        respond(true, null);
        return;
      }
      case 'transform': {
        const handler = transformHandlers.get(message.id);
        if (!handler) {
          throw new Error(`Transform not found: ${message.id}`);
        }
        const result = await handler(enrichContext<DocumentTransformContext>(message.payload));
        respond(true, toJsonContent(result) ?? null);
        return;
      }
      case 'exporter': {
        const handler = exporterHandlers.get(message.id);
        if (!handler) {
          throw new Error(`Exporter not found: ${message.id}`);
        }
        const result = await handler(enrichContext<ExporterContext>(message.payload));

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

        const result = await handler(enrichContext<StatusBadgeContext>(message.payload));
        respond(true, result ?? null);
        return;
      }
      case 'inline-annotations': {
        const handler = inlineAnnotationHandlers.get(message.id);
        if (!handler) {
          respond(true, []);
          return;
        }

        const result = await handler(enrichContext<InlineAnnotationContext>(message.payload));
        const output = Array.isArray(result) ? (result as InlineAnnotation[]) : [];
        respond(true, output);
        return;
      }
      case 'ui-control': {
        const handler = uiControlTriggerHandlers.get(message.id);
        if (!handler) {
          respond(true, { action: null } satisfies UIControlTriggerResult);
          return;
        }

        const result = await handler(enrichContext<UIControlStateContext>(message.payload));
        respond(true, result ?? { action: null } satisfies UIControlTriggerResult);
        return;
      }
      case 'ui-panel-action': {
        const handler = uiPanelActionHandlers.get(message.id);
        if (!handler) {
          respond(true, { action: null } satisfies UIPanelActionResult);
          return;
        }

        const result = await handler(enrichContext<UIPanelActionContext>(message.payload));
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
          enrichContext<UIControlStateContext>(payload.context)
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
  let ok = true;
  let error: string | undefined;

  try {
    if (pluginInstance?.dispose) {
      await pluginInstance.dispose();
    }
  } catch (caught) {
    ok = false;
    error = caught instanceof Error ? caught.message : String(caught);
  }

  commandHandlers.clear();
  transformHandlers.clear();
  exporterHandlers.clear();
  importerHandlers.clear();
  statusBadgeHandlers.clear();
  inlineAnnotationHandlers.clear();
  uiControlTriggerHandlers.clear();
  uiControlVisibleHandlers.clear();
  uiControlDisabledHandlers.clear();
  uiControlActiveHandlers.clear();
  uiPanelActionHandlers.clear();
  uiPanelRenderHandlers.clear();
  pendingHostRequests.clear();
  registrationTokens.clear();

  postWorkerMessage({
    type: 'worker:shutdown-complete',
    pluginId: currentPluginId,
    ok,
    error,
  });
  setTimeout(() => self.close(), 0);
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
