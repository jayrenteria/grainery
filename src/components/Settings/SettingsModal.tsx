import { useMemo, useState } from 'react';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import { useTheme, THEMES, Theme } from '../../contexts/ThemeContext';
import { Modal } from '../Modal';
import { TitlePagePreview } from '../TitlePage';
import type { TitlePageData } from '../../lib/types';
import type { OptionalPermission, PluginPermissionGrant, PluginRegistryEntry } from '../../plugins';
import { PluginManager } from '../../plugins';

interface SettingsModalProps {
  onClose: () => void;
  onOpenTitlePage: () => void;
  titlePage: TitlePageData | null;
  pluginManager: PluginManager;
  pluginStateVersion: number;
  onRunPluginExporter: (exporterId: string) => Promise<void>;
  onRunPluginImporter: (importerId: string) => Promise<void>;
}

type SettingsTab = 'theme' | 'title-page' | 'plugins';

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

export function SettingsModal({
  onClose,
  onOpenTitlePage,
  titlePage,
  pluginManager,
  pluginStateVersion,
  onRunPluginExporter,
  onRunPluginImporter,
}: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('theme');
  const [showPreview, setShowPreview] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [registryUrl, setRegistryUrl] = useState('https://plugins.grainery.app/index.json');
  const [registryEntries, setRegistryEntries] = useState<PluginRegistryEntry[]>([]);

  const plugins = useMemo(() => pluginManager.getInstalledPlugins(), [pluginManager, pluginStateVersion]);
  const commands = useMemo(() => pluginManager.getCommands(), [pluginManager, pluginStateVersion]);
  const exporters = useMemo(() => pluginManager.getExporters(), [pluginManager, pluginStateVersion]);
  const importers = useMemo(() => pluginManager.getImporters(), [pluginManager, pluginStateVersion]);

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
                <div className="grid grid-cols-2 gap-3 mt-2 sm:grid-cols-3 lg:grid-cols-4">
                  {THEMES.map((t) => (
                    <ThemeCard key={t} t={t} isSelected={theme === t} onClick={() => setTheme(t)} />
                  ))}
                </div>
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

                <div className="text-xs text-base-content/70">
                  Registered: {commands.length} commands, {exporters.length} exporters, {importers.length}{' '}
                  importers.
                </div>

                {(exporters.length > 0 || importers.length > 0 || commands.length > 0) && (
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

                    return (
                      <div key={plugin.id} className="rounded-lg border border-base-300 p-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-semibold">
                              {plugin.name} <span className="opacity-60">{plugin.version}</span>
                            </div>
                            <div className="text-xs opacity-70">{plugin.id}</div>
                            <div className="text-sm mt-1">{plugin.description}</div>
                            <div className="text-xs mt-1 opacity-70">
                              Trust: {plugin.trust} • Source: {plugin.installSource}
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
                          </div>
                        </div>

                        {plugin.manifest.optionalPermissions.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {plugin.manifest.optionalPermissions.map((permission) => (
                              <label key={permission} className="label cursor-pointer gap-2 px-2 py-1 rounded border border-base-300">
                                <span className="label-text text-xs">{permission}</span>
                                <input
                                  type="checkbox"
                                  className="checkbox checkbox-xs"
                                  checked={Boolean(grantsByPermission.get(permission))}
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
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {registryEntries.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <div className="text-xs font-semibold opacity-70">Registry Plugins</div>
                    {registryEntries.map((entry) => (
                      <div key={`${entry.id}:${entry.version}`} className="rounded border border-base-300 p-2 flex items-center justify-between gap-4">
                        <div>
                          <div className="font-semibold text-sm">
                            {entry.name} <span className="opacity-60">{entry.version}</span>
                          </div>
                          <div className="text-xs opacity-70">{entry.id}</div>
                          <div className="text-xs">{entry.description}</div>
                        </div>
                        <button
                          className="btn btn-primary btn-xs"
                          disabled={isBusy}
                          onClick={() => handleInstallFromRegistry(entry.id, entry.version)}
                        >
                          Install
                        </button>
                      </div>
                    ))}
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
