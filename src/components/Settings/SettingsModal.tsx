import { useEffect, useMemo, useState } from 'react';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import { useTheme, THEMES, Theme } from '../../contexts/ThemeContext';
import { Modal } from '../Modal';
import { TitlePagePreview } from '../TitlePage';
import type { TitlePageData } from '../../lib/types';
import type {
  InstalledPlugin,
  OptionalPermission,
  PluginLockRecord,
  PluginPermissionGrant,
  PluginRegistryEntry,
} from '../../plugins';
import { PluginManager } from '../../plugins';
import { PERMISSION_DESCRIPTIONS } from '../../plugins/permissions';

interface SettingsModalProps {
  onClose: () => void;
  onOpenTitlePage: () => void;
  titlePage: TitlePageData | null;
  pluginManager: PluginManager;
  pluginStateVersion: number;
  onRunPluginExporter: (exporterId: string) => Promise<void>;
  onRunPluginImporter: (importerId: string) => Promise<void>;
  keymapHintsEnabled: boolean;
  onKeymapHintsEnabledChange: (enabled: boolean) => void;
}

type SettingsTab = 'theme' | 'editor' | 'title-page' | 'plugins';

function capitalizeTheme(theme: string): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

function ThemeCard({ t, isSelected, onClick }: { t: Theme; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      data-theme={t}
      onClick={onClick}
      className={`flex flex-col rounded-lg overflow-hidden cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100' : 'hover:scale-105'
      }`}
    >
      <div className="flex h-10 w-full">
        <div className="w-1/3 h-full bg-primary" />
        <div className="w-1/3 h-full bg-secondary" />
        <div className="w-1/3 h-full bg-accent" />
      </div>
      <div className="bg-base-100 px-2 py-2 text-sm font-semibold text-base-content text-center">
        {capitalizeTheme(t)}
      </div>
    </button>
  );
}

function updatePermission(
  grants: PluginPermissionGrant[],
  permission: OptionalPermission,
  granted: boolean
): PluginPermissionGrant[] {
  const now = granted ? new Date().toISOString() : null;
  const found = grants.find((item) => item.permission === permission);

  if (!found) {
    return [...grants, { permission, granted, grantedAt: now }];
  }

  return grants.map((item) => {
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

function compareSemver(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .split(/[+-]/, 1)[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);

  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return left.localeCompare(right);
}

function getLatestRegistryEntry(entries: PluginRegistryEntry[], pluginId: string): PluginRegistryEntry | null {
  const matches = entries.filter((entry) => entry.id === pluginId);
  if (matches.length === 0) {
    return null;
  }

  return [...matches].sort((a, b) => compareSemver(b.version, a.version))[0];
}

function getTrustLabel(plugin: InstalledPlugin): { badge: string; text: string } {
  if (plugin.trust === 'verified' && plugin.installSource === 'registry') {
    return {
      badge: 'badge-success',
      text: 'Verified registry install',
    };
  }

  return {
    badge: 'badge-warning',
    text: 'Unverified sideload',
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function shortHash(value: string | null | undefined): string {
  if (!value) {
    return 'Unavailable';
  }

  return value.length > 16 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

export function SettingsModal({
  onClose,
  onOpenTitlePage,
  titlePage,
  pluginManager,
  pluginStateVersion,
  onRunPluginExporter,
  onRunPluginImporter,
  keymapHintsEnabled,
  onKeymapHintsEnabledChange,
}: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('theme');
  const [showPreview, setShowPreview] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [registryUrl, setRegistryUrl] = useState('https://plugins.grainery.app/index.json');
  const [registryEntries, setRegistryEntries] = useState<PluginRegistryEntry[]>([]);
  const [lockRecords, setLockRecords] = useState<PluginLockRecord[]>([]);

  const plugins = useMemo(() => pluginManager.getInstalledPlugins(), [pluginManager, pluginStateVersion]);
  const commands = useMemo(() => pluginManager.getCommands(), [pluginManager, pluginStateVersion]);
  const commandMenus = useMemo(() => pluginManager.getCommandMenus(), [pluginManager, pluginStateVersion]);
  const keybindings = useMemo(() => pluginManager.getKeybindings(), [pluginManager, pluginStateVersion]);
  const configurations = useMemo(() => pluginManager.getConfigurations(), [pluginManager, pluginStateVersion]);
  const exporters = useMemo(() => pluginManager.getExporters(), [pluginManager, pluginStateVersion]);
  const importers = useMemo(() => pluginManager.getImporters(), [pluginManager, pluginStateVersion]);

  useEffect(() => {
    let cancelled = false;

    void pluginManager
      .getLockRecords()
      .then((records) => {
        if (!cancelled) {
          setLockRecords(records);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPluginError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pluginManager, pluginStateVersion]);

  const lockRecordsByPlugin = useMemo(
    () => new Map(lockRecords.map((record) => [record.pluginId, record])),
    [lockRecords]
  );

  const handleOpenTitlePage = () => {
    onClose();
    onOpenTitlePage();
  };

  const runBusy = async (task: () => Promise<void>) => {
    setIsBusy(true);
    setPluginError(null);
    try {
      await task();
    } catch (error) {
      setPluginError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleInstallFromFile = () => {
    void runBusy(async () => {
      const path = await open({
        multiple: false,
        filters: [
          {
            name: 'Grainery Plugin',
            extensions: ['zip'],
          },
        ],
      });

      if (!path || Array.isArray(path)) {
        return;
      }

      await pluginManager.installFromFile(path);
    });
  };

  const handleFetchRegistry = () => {
    void runBusy(async () => {
      const entries = await pluginManager.fetchRegistryIndex(registryUrl);
      setRegistryEntries(entries);
    });
  };

  const handleInstallFromRegistry = (pluginId: string, version: string) => {
    void runBusy(async () => {
      const installed = plugins.find((plugin) => plugin.id === pluginId);
      const approved = await confirm(
        installed
          ? `Update ${installed.name} from ${installed.version} to ${version}?`
          : `Install registry plugin ${pluginId} ${version}?`,
        {
          title: installed ? 'Update Plugin' : 'Install Plugin',
          kind: 'info',
          okLabel: installed ? 'Update' : 'Install',
          cancelLabel: 'Cancel',
        }
      );

      if (!approved) {
        return;
      }

      await pluginManager.installFromRegistry(registryUrl, pluginId, version || null);
    });
  };

  const handleToggleEnabled = (pluginId: string, enabled: boolean) => {
    void runBusy(async () => {
      await pluginManager.setPluginEnabled(pluginId, enabled);
    });
  };

  const handleUninstall = (pluginId: string) => {
    void runBusy(async () => {
      const approved = await confirm(`Uninstall plugin ${pluginId}?`, {
        title: 'Uninstall Plugin',
        kind: 'warning',
        okLabel: 'Uninstall',
        cancelLabel: 'Cancel',
      });

      if (!approved) {
        return;
      }

      await pluginManager.uninstall(pluginId);
    });
  };

  const handlePermissionToggle = (
    pluginId: string,
    grants: PluginPermissionGrant[],
    permission: OptionalPermission,
    granted: boolean
  ) => {
    void runBusy(async () => {
      await pluginManager.updatePermissions(
        pluginId,
        updatePermission(grants, permission, granted)
      );
    });
  };

  const handleClearDiagnostics = (pluginId: string) => {
    void runBusy(async () => {
      await pluginManager.clearDiagnostics(pluginId);
    });
  };

  const handleRunExporter = (exporterId: string) => {
    void runBusy(async () => {
      await onRunPluginExporter(exporterId);
    });
  };

  const handleRunImporter = (importerId: string) => {
    void runBusy(async () => {
      await onRunPluginImporter(importerId);
    });
  };

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'theme', label: 'Theme' },
    { id: 'editor', label: 'Editor' },
    { id: 'title-page', label: 'Title Page' },
    { id: 'plugins', label: 'Plugins' },
  ];

  return (
    <>
      <Modal onClose={onClose} className="w-[90%] max-w-5xl max-h-[80vh] overflow-hidden gap-2">
        <h3 className="font-bold text-lg mb-4 text-base-content">Settings</h3>

        <div className="flex flex-col gap-4 md:flex-row md:gap-6 min-h-0 md:h-[60vh]">
          <aside className="md:w-52 md:shrink-0">
            <div className="md:sticky md:top-0">
              <div className="flex md:flex-col p-1 rounded-box gap-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className="relative px-3 py-2 text-sm text-base-content rounded-btn md:text-left transition-colors"
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span
                      aria-hidden
                      className={`absolute inset-0 rounded-btn bg-base-200 shadow-sm transition-opacity duration-200 ${
                        activeTab === tab.id ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                    <span className="relative z-10 font-bold">{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="min-h-0 flex-1 overflow-y-auto pr-1">
            {activeTab === 'theme' && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-base font-bold">Theme</span>
                </label>
                <div className="grid grid-cols-2 gap-3 mt-2 p-2 sm:grid-cols-3 lg:grid-cols-4">
                  {THEMES.map((t) => (
                    <ThemeCard key={t} t={t} isSelected={theme === t} onClick={() => setTheme(t)} />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'editor' && (
              <div className="form-control gap-3">
                <label className="label">
                  <span className="label-text text-base font-bold">Editor</span>
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-base-300 p-3">
                  <span>
                    <span className="block text-sm font-semibold text-base-content">Keyboard hints</span>
                    <span className="block text-xs text-base-content/60">
                      Show contextual key options at the bottom of the editor.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="toggle toggle-sm"
                    checked={keymapHintsEnabled}
                    onChange={(event) => onKeymapHintsEnabledChange(event.target.checked)}
                  />
                </label>
              </div>
            )}

            {activeTab === 'title-page' && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-base font-bold">Title Page</span>
                </label>
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-outline btn-sm" onClick={handleOpenTitlePage}>
                    Edit Title Page
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => setShowPreview(true)}>
                    Preview
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'plugins' && (
              <div className="form-control gap-3">
                <label className="label">
                  <span className="label-text text-base font-bold">Plugins</span>
                </label>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-outline btn-sm" disabled={isBusy} onClick={handleInstallFromFile}>
                    Install from file
                  </button>
                  <button className="btn btn-outline btn-sm" disabled={isBusy} onClick={handleFetchRegistry}>
                    Fetch registry
                  </button>
                  <input
                    className="input input-bordered input-sm min-w-72"
                    value={registryUrl}
                    onChange={(event) => setRegistryUrl(event.target.value)}
                    placeholder="Registry index URL"
                  />
                </div>

                {pluginError && <div className="alert alert-error py-2 text-sm">{pluginError}</div>}

                <div className="text-xs text-base-content/70 m-2">
                  Registered: {commands.length} commands, {commandMenus.length} menu entries,{' '}
                  {keybindings.length} keybindings, {exporters.length} exporters, {importers.length} importers.
                </div>

                {(exporters.length > 0 ||
                  importers.length > 0 ||
                  commands.length > 0 ||
                  commandMenus.length > 0 ||
                  keybindings.length > 0 ||
                  configurations.length > 0) && (
                  <div className="rounded-lg border border-base-300 p-3 space-y-2">
                    {commands.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold opacity-70 mb-1">Commands</div>
                        <div className="flex flex-wrap gap-1">
                          {commands.map((command) => (
                            <span key={command.id} className="badge badge-ghost">
                              {command.title}
                              {command.shortcut ? ` (${command.shortcut})` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {commandMenus.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold opacity-70 mb-1">Menu Entries</div>
                        <div className="flex flex-wrap gap-1">
                          {commandMenus.map((menu) => (
                            <span key={menu.id} className="badge badge-ghost">
                              {menu.title} ({menu.location})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {keybindings.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold opacity-70 mb-1">Keybindings</div>
                        <div className="flex flex-wrap gap-1">
                          {keybindings.map((keybinding) => (
                            <span key={keybinding.id} className="badge badge-ghost">
                              {keybinding.key}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {configurations.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold opacity-70 mb-1">Configuration</div>
                        <div className="flex flex-wrap gap-1">
                          {configurations.map((configuration) => (
                            <span key={configuration.pluginId} className="badge badge-ghost">
                              {configuration.title}: {configuration.properties.length}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {exporters.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold opacity-70 mb-1">Exporters</div>
                        <div className="flex flex-wrap gap-2">
                          {exporters.map((exporter) => (
                            <button
                              key={exporter.id}
                              className="btn btn-outline btn-xs"
                              disabled={isBusy}
                              onClick={() => handleRunExporter(exporter.id)}
                            >
                              Export via {exporter.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {importers.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold opacity-70 mb-1">Importers</div>
                        <div className="flex flex-wrap gap-2">
                          {importers.map((importer) => (
                            <button
                              key={importer.id}
                              className="btn btn-outline btn-xs"
                              disabled={isBusy}
                              onClick={() => handleRunImporter(importer.id)}
                            >
                              Import via {importer.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {plugins.length === 0 && (
                    <div className="text-sm text-base-content/60">No plugins installed.</div>
                  )}

                  {plugins.map((plugin) => {
                    const grantsByPermission = new Map(
                      plugin.grantedPermissions.map((item) => [item.permission, item.granted])
                    );
                    const trust = getTrustLabel(plugin);
                    const lockRecord = lockRecordsByPlugin.get(plugin.id);
                    const latestEntry = getLatestRegistryEntry(registryEntries, plugin.id);
                    const updateAvailable =
                      latestEntry !== null && compareSemver(latestEntry.version, plugin.version) > 0;

                    return (
                      <div key={plugin.id} className="rounded-lg border border-base-300 p-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-semibold">
                                {plugin.name} <span className="opacity-60">{plugin.version}</span>
                              </div>
                              <span className={`badge badge-sm ${trust.badge}`}>{trust.text}</span>
                              {updateAvailable && (
                                <span className="badge badge-info badge-sm">
                                  Update {latestEntry.version}
                                </span>
                              )}
                            </div>
                            <div className="text-xs opacity-70">{plugin.id}</div>
                            <div className="text-sm mt-1">{plugin.description}</div>
                            <div className="mt-2 grid gap-1 text-xs text-base-content/70 sm:grid-cols-2">
                              <div>Source: {plugin.installSource}</div>
                              <div>Installed: {formatDate(plugin.installedAt)}</div>
                              <div>Updated: {formatDate(plugin.updatedAt)}</div>
                              <div>Required permissions: {plugin.manifest.permissions.join(', ') || 'none'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="label cursor-pointer gap-2">
                              <span className="label-text text-xs">Enabled</span>
                              <input
                                type="checkbox"
                                className="toggle toggle-sm"
                                checked={plugin.enabled}
                                onChange={(event) =>
                                  handleToggleEnabled(plugin.id, event.target.checked)
                                }
                              />
                            </label>
                            <button
                              className="btn btn-error btn-outline btn-xs"
                              disabled={isBusy}
                              onClick={() => handleUninstall(plugin.id)}
                            >
                              Uninstall
                            </button>
                            {updateAvailable && (
                              <button
                                className="btn btn-primary btn-xs"
                                disabled={isBusy}
                                onClick={() =>
                                  handleInstallFromRegistry(plugin.id, latestEntry!.version)
                                }
                              >
                                Update
                              </button>
                            )}
                          </div>
                        </div>

                        {plugin.manifest.optionalPermissions.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs font-semibold text-base-content/70">
                              Optional permissions
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                              {plugin.manifest.optionalPermissions.map((permission) => {
                                const granted = Boolean(grantsByPermission.get(permission));
                                const rationale = plugin.manifest.permissionRationales?.[permission];

                                return (
                                  <label
                                    key={permission}
                                    className="flex cursor-pointer items-start justify-between gap-3 rounded border border-base-300 p-2"
                                  >
                                    <span className="min-w-0">
                                      <span className="block text-xs font-semibold">
                                        {permission}{' '}
                                        <span className={granted ? 'text-success' : 'text-warning'}>
                                          {granted ? 'Allowed' : 'Denied'}
                                        </span>
                                      </span>
                                      <span className="block text-xs text-base-content/70">
                                        {PERMISSION_DESCRIPTIONS[permission]}
                                      </span>
                                      <span className="block text-xs text-base-content/60">
                                        Rationale: {rationale || 'Not provided by author.'}
                                      </span>
                                    </span>
                                    <input
                                      type="checkbox"
                                      className="checkbox checkbox-xs mt-1"
                                      checked={granted}
                                      onChange={(event) =>
                                        handlePermissionToggle(
                                          plugin.id,
                                          plugin.grantedPermissions,
                                          permission,
                                          event.target.checked
                                        )
                                      }
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="mt-3 rounded border border-base-300 bg-base-200/40 p-2 text-xs text-base-content/70">
                          <div className="font-semibold text-base-content">Verification</div>
                          {lockRecord ? (
                            <div className="mt-1 grid gap-1 sm:grid-cols-2">
                              <div>Archive SHA-256: {shortHash(lockRecord.sha256)}</div>
                              <div>
                                Signature:{' '}
                                {lockRecord.signatureVerified
                                  ? `verified (${lockRecord.signatureKeyId ?? 'key unknown'})`
                                  : 'not verified'}
                              </div>
                              <div>Lock trust: {lockRecord.trust}</div>
                              <div>Lock source: {lockRecord.installSource ?? plugin.installSource}</div>
                              {lockRecord.registryUrl && <div>Registry: {lockRecord.registryUrl}</div>}
                              {lockRecord.downloadUrl && <div>Download: {lockRecord.downloadUrl}</div>}
                            </div>
                          ) : (
                            <div className="mt-1">No lock record found for this install.</div>
                          )}
                        </div>

                        {(plugin.crashCount > 0 || plugin.diagnostics.length > 0) && (
                          <div className="mt-3 rounded border border-warning/40 bg-warning/10 p-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-semibold">
                                Diagnostics
                                {plugin.crashCount > 0 ? ` • ${plugin.crashCount} crashes` : ''}
                              </div>
                              <button
                                className="btn btn-ghost btn-xs"
                                disabled={isBusy}
                                onClick={() => handleClearDiagnostics(plugin.id)}
                              >
                                Clear
                              </button>
                            </div>
                            <div className="mt-2 space-y-1">
                              {plugin.diagnostics.slice(-5).reverse().map((diagnostic) => (
                                <div
                                  key={diagnostic.id}
                                  className="rounded border border-base-300 bg-base-100 p-2 text-xs"
                                >
                                  <div className="font-semibold">
                                    {diagnostic.kind}
                                    {diagnostic.operation ? ` • ${diagnostic.operation}` : ''}
                                    {diagnostic.count > 1 ? ` • ${diagnostic.count}x` : ''}
                                  </div>
                                  <div className="text-base-content/70">{diagnostic.message}</div>
                                  <div className="text-base-content/50">
                                    {formatDate(diagnostic.occurredAt)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {registryEntries.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <div className="text-xs font-semibold opacity-70">Registry Plugins</div>
                    {registryEntries.map((entry) => {
                      const installed = plugins.find((plugin) => plugin.id === entry.id);
                      const isUpdate =
                        installed !== undefined && compareSemver(entry.version, installed.version) > 0;
                      const isInstalled =
                        installed !== undefined && compareSemver(entry.version, installed.version) === 0;

                      return (
                        <div
                          key={`${entry.id}:${entry.version}`}
                          className="rounded border border-base-300 p-2 flex items-center justify-between gap-4"
                        >
                          <div>
                            <div className="flex flex-wrap items-center gap-2 font-semibold text-sm">
                              <span>
                                {entry.name} <span className="opacity-60">{entry.version}</span>
                              </span>
                              <span className="badge badge-info badge-xs">Registry candidate</span>
                              {isInstalled && <span className="badge badge-ghost badge-xs">Installed</span>}
                              {isUpdate && <span className="badge badge-info badge-xs">Update</span>}
                            </div>
                            <div className="text-xs opacity-70">{entry.id}</div>
                            <div className="text-xs">{entry.description}</div>
                            <div className="text-xs opacity-70">
                              SHA-256: {shortHash(entry.sha256)} • Key: {entry.signatureKeyId}
                            </div>
                          </div>
                          <button
                            className="btn btn-primary btn-xs"
                            disabled={isBusy || isInstalled}
                            onClick={() => handleInstallFromRegistry(entry.id, entry.version)}
                          >
                            {isUpdate ? 'Update' : isInstalled ? 'Installed' : 'Install'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn btn-primary px-6!" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
 
      {showPreview && <TitlePagePreview titlePage={titlePage} onClose={() => setShowPreview(false)} />}
    </>
  );
}
