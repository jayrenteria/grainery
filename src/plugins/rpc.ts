import type {
  HostToWorkerMessage,
  OptionalPermission,
  WorkerToHostMessage,
} from './types';
import { isOptionalPermission } from './permissions';

let requestCounter = 0;

export function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}-${Date.now()}-${requestCounter}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalPermissionValue(value: unknown): value is OptionalPermission {
  return hasString(value) && isOptionalPermission(value);
}

export function parseWorkerMessage(value: unknown): WorkerToHostMessage | null {
  if (!isObject(value) || !hasString(value.type)) {
    return null;
  }

  switch (value.type) {
    case 'worker:ready':
    case 'worker:error':
    case 'worker:register-element-loop-provider':
    case 'worker:register-command':
    case 'worker:register-transform':
    case 'worker:register-exporter':
    case 'worker:register-importer':
    case 'worker:register-status-badge':
    case 'worker:register-ui-control':
    case 'worker:register-ui-panel':
    case 'worker:host-request':
    case 'worker:permission-request':
    case 'worker:response':
      return value as unknown as WorkerToHostMessage;
    default:
      return null;
  }
}

export function parseHostMessage(value: unknown): HostToWorkerMessage | null {
  if (!isObject(value) || !hasString(value.type)) {
    return null;
  }

  switch (value.type) {
    case 'host:init':
    case 'host:invoke':
    case 'host:response':
    case 'host:shutdown':
      return value as unknown as HostToWorkerMessage;
    default:
      return null;
  }
}

export function isPermissionRequest(message: unknown): message is {
  permission: OptionalPermission;
} {
  if (!isObject(message)) {
    return false;
  }

  return isOptionalPermissionValue(message.permission);
}
