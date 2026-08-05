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
  'system:fonts',
];

export const PERMISSION_LABELS: Record<OptionalPermission, string> = {
  'fs:pick-read': 'Open a file you choose',
  'fs:pick-write': 'Save a file you choose',
  'network:https': 'Connect to websites',
  'ui:mount': 'Add plugin controls',
  'editor:annotations': 'Show notes in your screenplay',
  'system:fonts': 'Use your installed fonts',
};

export const PERMISSION_DESCRIPTIONS: Record<OptionalPermission, string> = {
  'fs:pick-read': 'Grainery will ask you which file before giving the plugin access.',
  'fs:pick-write': 'Grainery will ask you where to save the file first.',
  'network:https': 'Connect only to the websites listed by the plugin.',
  'ui:mount': 'This gives the plugin a place to show its controls.',
  'editor:annotations': 'These notes are visual and do not change your screenplay text.',
  'system:fonts': 'The plugin sees font names and styles, not the contents of your files.',
};

export interface PluginPermissionPrompt {
  title: string;
  message: string;
}

const PERMISSION_PROMPT_COPY: Record<
  OptionalPermission,
  { title: (pluginName: string) => string; request: (pluginName: string) => string }
> = {
  'fs:pick-read': {
    title: (pluginName) => `Let ${pluginName} open a file?`,
    request: (pluginName) =>
      `${pluginName} would like to open a local file after you choose it.`,
  },
  'fs:pick-write': {
    title: (pluginName) => `Let ${pluginName} save a file?`,
    request: (pluginName) =>
      `${pluginName} would like to save a local file after you choose where it goes.`,
  },
  'network:https': {
    title: (pluginName) => `Let ${pluginName} connect to websites?`,
    request: (pluginName) =>
      `${pluginName} would like to connect to the websites listed by the plugin.`,
  },
  'ui:mount': {
    title: (pluginName) => `Show ${pluginName} in Grainery?`,
    request: (pluginName) =>
      `${pluginName} would like to add its button and panel to Grainery.`,
  },
  'editor:annotations': {
    title: (pluginName) => `Let ${pluginName} show screenplay notes?`,
    request: (pluginName) =>
      `${pluginName} would like to add visual notes alongside your screenplay text.`,
  },
  'system:fonts': {
    title: (pluginName) => `Let ${pluginName} use your installed fonts?`,
    request: (pluginName) =>
      `${pluginName} would like to see and preview the fonts installed on this computer.`,
  },
};

export function buildPluginPermissionPrompt(
  plugin: InstalledPlugin,
  permission: OptionalPermission
): PluginPermissionPrompt {
  const copy = PERMISSION_PROMPT_COPY[permission];
  const sourceNote =
    plugin.trust === 'verified'
      ? 'This plugin came from Grainery’s plugin catalog.'
      : 'This plugin was installed from outside Grainery. Only allow this if you trust where it came from.';

  return {
    title: copy.title(plugin.name),
    message: [
      copy.request(plugin.name),
      '',
      PERMISSION_DESCRIPTIONS[permission],
      '',
      sourceNote,
      '',
      'You can change this later in Settings > Plugins.',
    ].join('\n'),
  };
}

export function getOptionalPermissionsToPrompt(
  installed: InstalledPlugin,
  previous?: InstalledPlugin
): OptionalPermission[] {
  return installed.manifest.optionalPermissions.filter(
    (permission) =>
      !previous?.grantedPermissions.some((grant) => grant.permission === permission)
  );
}

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
