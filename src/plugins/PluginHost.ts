import { invoke } from '@tauri-apps/api/core';
import type { JSONContent } from '@tiptap/react';
import { hasPluginPermission } from './permissions';
import type {
  HostOperation,
  InstalledPlugin,
  OptionalPermission,
  PluginPermissionGrant,
} from './types';

interface PluginHostOptions {
  getDocument: () => JSONContent;
  replaceDocument: (next: JSONContent) => void | Promise<void>;
}

export class PluginHost {
  private getDocument: () => JSONContent;
  private replaceDocument: (next: JSONContent) => void | Promise<void>;

  constructor(options: PluginHostOptions) {
    this.getDocument = options.getDocument;
    this.replaceDocument = options.replaceDocument;
  }

  updateDocumentAccess(options: PluginHostOptions): void {
    this.getDocument = options.getDocument;
    this.replaceDocument = options.replaceDocument;
  }

  readDocument(): JSONContent {
    return this.getDocument();
  }

  async handleHostOperation(
    plugin: InstalledPlugin,
    operation: HostOperation,
    payload: unknown
  ): Promise<unknown> {
    switch (operation) {
      case 'document:get': {
        if (!hasPluginPermission(plugin, 'document:read')) {
          throw new Error('Permission denied: document:read');
        }
        return this.getDocument();
      }

      case 'document:replace': {
        if (!hasPluginPermission(plugin, 'document:write')) {
          throw new Error('Permission denied: document:write');
        }

        await this.replaceDocument(payload as JSONContent);
        return true;
      }

      default:
        return invoke('plugin_host_call', {
          pluginId: plugin.id,
          operation,
          payload,
        });
    }
  }

  async requestPermission(
    plugin: InstalledPlugin,
    permission: OptionalPermission
  ): Promise<boolean> {
    if (!plugin.manifest.optionalPermissions.includes(permission)) {
      return false;
    }

    const existing = plugin.grantedPermissions.find((item) => item.permission === permission);
    if (existing?.granted) {
      return true;
    }

    const message = [
      `Plugin ${plugin.name} (${plugin.id}) requests permission: ${permission}.`,
      '',
      'Allow this permission?',
    ].join('\n');

    const allowed = window.confirm(message);

    const nextGrants = this.withUpdatedGrant(plugin.grantedPermissions, permission, allowed);

    await invoke('plugin_update_permissions', {
      pluginId: plugin.id,
      permissions: nextGrants,
    });

    const applied = plugin.grantedPermissions.find((item) => item.permission === permission);
    if (applied) {
      applied.granted = allowed;
      applied.grantedAt = allowed ? new Date().toISOString() : null;
    } else {
      plugin.grantedPermissions.push({
        permission,
        granted: allowed,
        grantedAt: allowed ? new Date().toISOString() : null,
      });
    }

    return allowed;
  }

  private withUpdatedGrant(
    current: PluginPermissionGrant[],
    permission: OptionalPermission,
    granted: boolean
  ): PluginPermissionGrant[] {
    const now = granted ? new Date().toISOString() : null;
    const found = current.find((item) => item.permission === permission);

    if (!found) {
      return [
        ...current,
        {
          permission,
          granted,
          grantedAt: now,
        },
      ];
    }

    return current.map((item) => {
      if (item.permission !== permission) {
        return item;
      }

      return {
        ...item,
        granted,
        grantedAt: now,
      };
    });
  }
}
