import type {
  CorePermission,
  InstalledPlugin,
  OptionalPermission,
  PluginPermission,
  PluginPermissionGrant,
} from './types';

export const CORE_PERMISSIONS: CorePermission[] = [
  'document:read',
  'document:write',
  'editor:commands',
  'export:register',
];

export const OPTIONAL_PERMISSIONS: OptionalPermission[] = [
  'fs:pick-read',
  'fs:pick-write',
  'network:https',
  'ui:mount',
];

export function isOptionalPermission(value: string): value is OptionalPermission {
  return OPTIONAL_PERMISSIONS.includes(value as OptionalPermission);
}

export function isCorePermission(value: string): value is CorePermission {
  return CORE_PERMISSIONS.includes(value as CorePermission);
}

export function hasPluginPermission(
  plugin: InstalledPlugin,
  permission: PluginPermission
): boolean {
  if (plugin.manifest.permissions.includes(permission as CorePermission)) {
    return true;
  }

  const grant = plugin.grantedPermissions.find((item) => item.permission === permission);
  return Boolean(grant?.granted);
}

export function normalizePermissionGrants(
  optionalPermissions: OptionalPermission[],
  existing: PluginPermissionGrant[]
): PluginPermissionGrant[] {
  const byPermission = new Map(existing.map((item) => [item.permission, item]));

  return optionalPermissions.map((permission) => {
    const found = byPermission.get(permission);
    if (found) {
      return found;
    }

    return {
      permission,
      granted: false,
      grantedAt: null,
    };
  });
}
