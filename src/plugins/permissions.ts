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
  'editor:annotations',
];

export const PERMISSION_DESCRIPTIONS: Record<OptionalPermission, string> = {
  'fs:pick-read': 'Ask you to choose a local file the plugin can read.',
  'fs:pick-write': 'Ask you to choose a local destination the plugin can write.',
  'network:https': 'Make HTTPS requests to hosts declared in the plugin allowlist.',
  'ui:mount': 'Render host-controlled toolbar controls or side panels.',
  'editor:annotations': 'Show host-rendered inline annotations in the editor.',
};

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
