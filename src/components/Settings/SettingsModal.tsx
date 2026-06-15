import { useEffect, useMemo, useState } from 'react';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import { useTheme, THEMES, Theme } from '../../contexts/ThemeContext';
import { TitlePagePreviewPage } from '../TitlePage';
import type { DocumentMode, TitlePageData } from '../../lib/types';
import type {
  OptionalPermission,
  PluginPermissionGrant,
} from '../../plugins';
import { PluginManager } from '../../plugins';
import { PERMISSION_DESCRIPTIONS } from '../../plugins/permissions';

interface SettingsModalProps {
  onClose: () => void;
  documentMode: DocumentMode;
  titlePage: TitlePageData | null;
  onTitlePageChange: (titlePage: TitlePageData | null) => void;
  pluginManager: PluginManager;
  pluginStateVersion: number;
  keymapHintsEnabled: boolean;
  onKeymapHintsEnabledChange: (enabled: boolean) => void;
  recentDocumentsPanelEnabled: boolean;
  onRecentDocumentsPanelEnabledChange: (enabled: boolean) => void;
  autoSaveEnabled: boolean;
  autoSaveIntervalMs: number;
  onAutoSaveEnabledChange: (enabled: boolean) => void;
  onAutoSaveIntervalChange: (intervalMs: number) => void;
}

type SettingsTab = 'theme' | 'editor' | 'title-page' | 'plugins';

const EMPTY_TITLE_PAGE: TitlePageData = {
  title: '',
  credit: 'Written by',
  author: '',
  source: '',
  draftDate: '',
  contact: '',
  copyright: '',
  notes: '',
};

const AUTO_SAVE_INTERVAL_OPTIONS = [
  { value: 15_000, label: '15 seconds' },
  { value: 30_000, label: '30 seconds' },
  { value: 60_000, label: '1 minute' },
  { value: 300_000, label: '5 minutes' },
] as const;

function capitalizeTheme(theme: string): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

function normalizeTitlePage(titlePage: TitlePageData): TitlePageData | null {
  if (titlePage.title.trim() || titlePage.author.trim()) {
    return titlePage;
  }

  return null;
}

function ThemeCard({ t, isSelected, onClick }: { t: Theme; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-theme={t}
      onClick={onClick}
      className={`settings-theme-card ${isSelected ? 'is-selected' : ''}`}
    >
      <div className="settings-theme-card-swatch">
        <span className="bg-primary" />
        <span className="bg-secondary" />
        <span className="bg-accent" />
      </div>
      <div className="settings-theme-card-label">
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
  documentMode,
  titlePage,
  onTitlePageChange,
  pluginManager,
  pluginStateVersion,
  keymapHintsEnabled,
  onKeymapHintsEnabledChange,
  recentDocumentsPanelEnabled,
  onRecentDocumentsPanelEnabledChange,
  autoSaveEnabled,
  autoSaveIntervalMs,
  onAutoSaveEnabledChange,
  onAutoSaveIntervalChange,
}: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>('theme');
  const [titlePageForm, setTitlePageForm] = useState<TitlePageData>(titlePage || EMPTY_TITLE_PAGE);
  const [isBusy, setIsBusy] = useState(false);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const isScreenplayDocument = documentMode === 'screenplay';

  const plugins = useMemo(() => pluginManager.getInstalledPlugins(), [pluginManager, pluginStateVersion]);

  useEffect(() => {
    setTitlePageForm(titlePage || EMPTY_TITLE_PAGE);
  }, [titlePage]);

  const handleTitlePageFieldChange = (field: keyof TitlePageData, value: string) => {
    setTitlePageForm((prev) => {
      const next = { ...prev, [field]: value };
      onTitlePageChange(normalizeTitlePage(next));
      return next;
    });
  };

  const handleClearTitlePage = () => {
    setTitlePageForm(EMPTY_TITLE_PAGE);
    onTitlePageChange(null);
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

  const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
    { id: 'theme', label: 'Themes', icon: '◐' },
    { id: 'editor', label: 'Editor', icon: '¶' },
    ...(isScreenplayDocument
      ? [{ id: 'title-page' as const, label: 'Title Page', icon: '▤' }]
      : []),
    { id: 'plugins', label: 'Plugins', icon: '⊕' },
  ];

  const handleToggleTopbarTheme = () => {
    setTheme(theme === 'dark' ? 'grainery' : 'dark');
  };

  return (
    <>
      <main className="settings-screen">
        <nav className="settings-topbar" aria-label="Settings navigation">
          <div className="settings-topbar-left">
            <button type="button" className="settings-back-button" onClick={onClose} aria-label="Back">
              <span aria-hidden="true">←</span>
            </button>
            <span className="settings-topbar-label">Settings</span>
          </div>
          <button
            type="button"
            className="settings-topbar-theme"
            onClick={handleToggleTopbarTheme}
            aria-label="Toggle dark theme"
          >
            <span aria-hidden="true">☼</span>
          </button>
        </nav>

        <div className="settings-page-heading">
          <h1>Settings</h1>
        </div>

        <div className="settings-body">
          <aside className="settings-sidebar" aria-label="Settings sections">
            <div className="settings-sidebar-inner">
              <div className="settings-tabs" role="tablist" aria-orientation="vertical">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`settings-tab ${activeTab === tab.id ? 'is-active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span aria-hidden="true" className="settings-tab-icon">{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="settings-content">
            {activeTab === 'theme' && (
              <div className="settings-panel">
                <p className="settings-panel-intro">
                  Set the surface you write on. Themes follow you between the library and the page.
                </p>
                <p className="settings-section-label">Surface</p>
                <div className="settings-theme-grid">
                  {THEMES.map((t) => (
                    <ThemeCard key={t} t={t} isSelected={theme === t} onClick={() => setTheme(t)} />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'editor' && (
              <div className="settings-panel settings-editor-panel">
                <p className="settings-panel-intro">
                  Keep the page quiet, with only the writing prompts you want in view.
                </p>

                <div className="settings-editor-group">
                  <p className="settings-section-label">Assistance</p>

                  <label className="settings-editor-option">
                    <span className="settings-editor-option-copy">
                      <span>Keyboard hints</span>
                      <small>Show contextual key options at the bottom of the editor.</small>
                    </span>
                    <span className="settings-editor-option-control">
                      <span aria-hidden="true">{keymapHintsEnabled ? 'On' : 'Off'}</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={keymapHintsEnabled}
                        onChange={(event) => onKeymapHintsEnabledChange(event.target.checked)}
                      />
                    </span>
                  </label>

                  <label className="settings-editor-option">
                    <span className="settings-editor-option-copy">
                      <span>Recent documents rail</span>
                      <small>Show the side rail for opening recent documents from the editor.</small>
                    </span>
                    <span className="settings-editor-option-control">
                      <span aria-hidden="true">{recentDocumentsPanelEnabled ? 'On' : 'Off'}</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={recentDocumentsPanelEnabled}
                        onChange={(event) => onRecentDocumentsPanelEnabledChange(event.target.checked)}
                      />
                    </span>
                  </label>
                </div>

                <div className="settings-editor-group">
                  <p className="settings-section-label">Autosave</p>

                  <label className="settings-editor-option">
                    <span className="settings-editor-option-copy">
                      <span>Autosave</span>
                      <small>Automatically save changes while you write.</small>
                    </span>
                    <span className="settings-editor-option-control">
                      <span aria-hidden="true">{autoSaveEnabled ? 'On' : 'Off'}</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={autoSaveEnabled}
                        onChange={(event) => onAutoSaveEnabledChange(event.target.checked)}
                      />
                    </span>
                  </label>

                  {autoSaveEnabled && (
                    <label className="settings-editor-option settings-editor-option-select">
                      <span className="settings-editor-option-copy">
                        <span>Save every</span>
                        <small>Choose how long Grainery waits after your last change.</small>
                      </span>
                      <span className="settings-editor-option-control">
                        <select
                          className="settings-editor-select"
                          value={autoSaveIntervalMs}
                          onChange={(event) => onAutoSaveIntervalChange(Number(event.target.value))}
                        >
                          {AUTO_SAVE_INTERVAL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </span>
                    </label>
                  )}
                </div>
              </div>
            )}

            {isScreenplayDocument && activeTab === 'title-page' && (
              <div className="settings-panel settings-panel-wide">
                <p className="settings-panel-intro">
                  Manage the title page data attached to the current document.
                </p>
                <p className="settings-section-label">Title Page</p>

                <div className="settings-title-page-workspace">
                  <form className="settings-title-page-form" onSubmit={(event) => event.preventDefault()}>
                    <label className="settings-field">
                      <span>Title</span>
                      <input
                        type="text"
                        value={titlePageForm.title}
                        onChange={(event) => handleTitlePageFieldChange('title', event.target.value)}
                        placeholder="SCREENPLAY TITLE"
                      />
                    </label>

                    <div className="settings-field-grid">
                      <label className="settings-field">
                        <span>Credit</span>
                        <input
                          type="text"
                          value={titlePageForm.credit || ''}
                          onChange={(event) => handleTitlePageFieldChange('credit', event.target.value)}
                          placeholder="Written by"
                        />
                      </label>

                      <label className="settings-field">
                        <span>Author</span>
                        <input
                          type="text"
                          value={titlePageForm.author}
                          onChange={(event) => handleTitlePageFieldChange('author', event.target.value)}
                          placeholder="Author Name"
                        />
                      </label>
                    </div>

                    <label className="settings-field">
                      <span>Source</span>
                      <input
                        type="text"
                        value={titlePageForm.source || ''}
                        onChange={(event) => handleTitlePageFieldChange('source', event.target.value)}
                        placeholder="Based on..."
                      />
                    </label>

                    <div className="settings-field-grid">
                      <label className="settings-field">
                        <span>Draft Date</span>
                        <input
                          type="text"
                          value={titlePageForm.draftDate || ''}
                          onChange={(event) => handleTitlePageFieldChange('draftDate', event.target.value)}
                          placeholder="January 2025"
                        />
                      </label>

                      <label className="settings-field">
                        <span>Copyright</span>
                        <input
                          type="text"
                          value={titlePageForm.copyright || ''}
                          onChange={(event) => handleTitlePageFieldChange('copyright', event.target.value)}
                          placeholder="© 2025"
                        />
                      </label>
                    </div>

                    <label className="settings-field">
                      <span>Contact</span>
                      <textarea
                        value={titlePageForm.contact || ''}
                        onChange={(event) => handleTitlePageFieldChange('contact', event.target.value)}
                        placeholder="Contact information..."
                        rows={3}
                      />
                    </label>

                    <label className="settings-field">
                      <span>Notes</span>
                      <textarea
                        value={titlePageForm.notes || ''}
                        onChange={(event) => handleTitlePageFieldChange('notes', event.target.value)}
                        placeholder="Additional notes..."
                        rows={2}
                      />
                    </label>

                    <button type="button" className="settings-clear-button" onClick={handleClearTitlePage}>
                      Clear Title Page
                    </button>
                  </form>

                  <aside className="settings-title-page-preview" aria-label="Title page preview">
                    <TitlePagePreviewPage titlePage={normalizeTitlePage(titlePageForm)} />
                  </aside>
                </div>
              </div>
            )}

            {activeTab === 'plugins' && (
              <div className="settings-panel settings-plugins-panel">
                <p className="settings-panel-intro">
                  Small, optional extensions. Grainery stays quiet by default.
                </p>

                <div className="settings-plugin-group">
                  <p className="settings-section-label">Install</p>

                  <div className="settings-plugin-option">
                    <span className="settings-plugin-option-copy">
                      <span>Local install</span>
                      <small>Install a packaged Grainery plugin from disk.</small>
                    </span>
                    <button
                      type="button"
                      className="settings-inline-button"
                      disabled={isBusy}
                      onClick={handleInstallFromFile}
                    >
                      Install from file
                    </button>
                  </div>
                </div>

                {pluginError && <div className="alert alert-error py-2 text-sm">{pluginError}</div>}

                <div className="settings-plugin-group">
                  <p className="settings-section-label">Installed</p>
                  <div className="settings-plugin-list">
                    {plugins.length === 0 && (
                      <div className="settings-empty">No plugins installed.</div>
                    )}

                    {plugins.map((plugin) => {
                      const grantsByPermission = new Map(
                        plugin.grantedPermissions.map((item) => [item.permission, item.granted])
                      );

                      return (
                        <div key={plugin.id} className="settings-plugin-card">
                          <div className="settings-plugin-card-top">
                            <div className="settings-plugin-card-copy">
                              <div>
                                {plugin.name} <span>{plugin.version}</span>
                              </div>
                              {plugin.description && <small>{plugin.description}</small>}
                            </div>
                            <label className="settings-plugin-enabled">
                              <span>{plugin.enabled ? 'On' : 'Off'}</span>
                              <input
                                type="checkbox"
                                className="toggle toggle-sm"
                                checked={plugin.enabled}
                                onChange={(event) =>
                                  handleToggleEnabled(plugin.id, event.target.checked)
                                }
                              />
                            </label>
                          </div>

                          <div className="settings-plugin-actions">
                            <button
                              type="button"
                              className="settings-inline-button settings-inline-button-danger"
                              disabled={isBusy}
                              onClick={() => handleUninstall(plugin.id)}
                            >
                              Uninstall
                            </button>
                          </div>

                          {plugin.manifest.optionalPermissions.length > 0 && (
                            <div className="settings-plugin-permissions">
                              <div className="settings-plugin-subhead">
                                Optional permissions
                              </div>
                              <div className="settings-plugin-permission-grid">
                                {plugin.manifest.optionalPermissions.map((permission) => {
                                  const granted = Boolean(grantsByPermission.get(permission));
                                  const rationale = plugin.manifest.permissionRationales?.[permission];

                                  return (
                                    <label
                                      key={permission}
                                      className="settings-plugin-permission"
                                    >
                                      <span className="min-w-0">
                                        <span>
                                          {permission}{' '}
                                          <span className={granted ? 'text-success' : 'text-warning'}>
                                            {granted ? 'Allowed' : 'Denied'}
                                          </span>
                                        </span>
                                        <small>
                                          {PERMISSION_DESCRIPTIONS[permission]}
                                        </small>
                                        <small>
                                          Rationale: {rationale || 'Not provided by author.'}
                                        </small>
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
 
    </>
  );
}
