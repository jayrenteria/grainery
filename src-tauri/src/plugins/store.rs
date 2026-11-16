use super::archive::{extract_zip_to_directory, inspect_plugin_archive};
use super::manifest::{normalize_grants, validate_plugin_id};
use super::registry::{compute_sha256_hex, validate_registry_archive_identity};
use super::types::{
    InstalledPlugin, PluginDiagnostic, PluginLockRecord, PluginRegistryEntry, PluginStore,
};
use chrono::Utc;
use serde_json::{json, Value};
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

static PLUGIN_STORE_LOCK: Mutex<()> = Mutex::new(());
pub(super) static TEMP_PATH_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const PLUGIN_AUDIT_LOG_FILE: &str = "plugin-audit.log";
pub(super) const PLUGIN_STORE_FILE: &str = "plugins-state.json";
pub(super) fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub(super) fn lock_plugin_store() -> Result<MutexGuard<'static, ()>, String> {
    PLUGIN_STORE_LOCK
        .lock()
        .map_err(|_| "Plugin store lock is poisoned".to_string())
}

fn sanitize_plugin_id(plugin_id: &str) -> String {
    plugin_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
}

pub(super) fn plugin_root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))?;
    let root = app_data.join("plugins");

    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create plugin root directory: {}", error))?;

    Ok(root)
}

fn plugin_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(plugin_root(app)?.join(PLUGIN_STORE_FILE))
}

fn plugin_install_base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = plugin_root(app)?.join("installed");
    fs::create_dir_all(&base_dir)
        .map_err(|error| format!("Failed to create plugin install directory: {}", error))?;
    Ok(base_dir)
}

pub(super) fn load_store(app: &AppHandle) -> Result<PluginStore, String> {
    let store_path = plugin_store_path(app)?;
    let mut store = load_store_from_path(&store_path)?;
    recover_pending_uninstalls(&plugin_root(app)?, &store)?;
    recover_plugin_installations(app, &mut store)?;
    Ok(store)
}

pub(super) fn persistent_backup_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent directory: {:?}", path))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Path has no valid file name: {:?}", path))?;

    Ok(parent.join(format!("{}.backup", file_name)))
}

fn parse_store_file(path: &Path) -> Result<PluginStore, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read plugin store file {:?}: {}", path, error))?;

    serde_json::from_str::<PluginStore>(&content)
        .map_err(|error| format!("Failed to parse plugin store JSON {:?}: {}", path, error))
}

pub(super) fn load_store_from_path(store_path: &Path) -> Result<PluginStore, String> {
    let backup_path = persistent_backup_path(store_path)?;

    if !store_path.exists() && !backup_path.exists() {
        return Ok(PluginStore::default());
    }

    match parse_store_file(store_path) {
        Ok(store) => Ok(store),
        Err(primary_error) if backup_path.exists() => {
            let store = parse_store_file(&backup_path).map_err(|backup_error| {
                format!(
                    "{}; backup recovery failed: {}",
                    primary_error, backup_error
                )
            })?;
            fs::copy(&backup_path, store_path).map_err(|error| {
                format!(
                    "Recovered plugin state from backup but failed to restore {:?}: {}",
                    store_path, error
                )
            })?;
            Ok(store)
        }
        Err(error) => Err(error),
    }
}

fn sync_file(path: &Path) -> Result<(), String> {
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Failed to sync file {:?}: {}", path, error))
}

pub(super) fn save_store(app: &AppHandle, store: &PluginStore) -> Result<(), String> {
    let store_path = plugin_store_path(app)?;
    let payload = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Failed to serialize plugin store JSON: {}", error))?;

    write_file_atomically(&store_path, payload.as_bytes())
}

fn temporary_sibling_path(path: &Path, label: &str) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent directory: {:?}", path))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Path has no valid file name: {:?}", path))?;
    let sequence = TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    Ok(parent.join(format!(
        ".{}.{}.{}.{}.{}",
        file_name,
        std::process::id(),
        timestamp,
        sequence,
        label
    )))
}

pub(super) fn write_file_atomically(path: &Path, payload: &[u8]) -> Result<(), String> {
    if path.exists() {
        let backup_path = persistent_backup_path(path)?;
        fs::copy(path, &backup_path)
            .map_err(|error| format!("Failed to back up plugin state: {}", error))?;
        sync_file(&backup_path)?;
    }
    crate::file_io::write_file_atomically(path, payload)
        .map_err(|error| format!("Failed to replace plugin state: {}", error))
}

pub(super) fn hydrate_entry_source(plugin: &mut InstalledPlugin) {
    if !plugin.enabled {
        plugin.entry_source = None;
        return;
    }

    let source = fs::read_to_string(&plugin.entry_path).ok();
    plugin.entry_source = source;
}

pub(super) fn recover_pending_uninstalls(root: &Path, store: &PluginStore) -> Result<(), String> {
    let pending = root.join("pending-uninstalls");
    if !pending.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&pending)
        .map_err(|error| format!("Failed to read pending uninstalls: {}", error))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let id = entry
            .file_name()
            .into_string()
            .map_err(|_| "Invalid pending plugin ID".to_string())?;
        if !validate_plugin_id(&id) {
            return Err("Invalid pending plugin ID".to_string());
        }
        let live = root.join("installed").join(&id);
        let result = if store.installed_plugins.iter().any(|plugin| plugin.id == id) {
            if live.exists() {
                continue;
            }
            fs::rename(entry.path(), live)
        } else {
            fs::remove_dir_all(entry.path())
        };
        if let Err(error) = result {
            // Retain failed cleanup for retry; missing live entries are isolated below.
            eprintln!("Pending uninstall recovery for {}: {}", id, error);
        }
    }
    Ok(())
}

pub(super) fn uninstall_with_commit(
    root: &Path,
    plugin_id: &str,
    commit: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let live = root.join("installed").join(plugin_id);
    let pending_root = root.join("pending-uninstalls");
    let staged = pending_root.join(plugin_id);
    if staged.exists() {
        return Err("A previous plugin uninstall still needs recovery".to_string());
    }
    let had_installation = live.exists();
    if had_installation {
        fs::create_dir_all(&pending_root).map_err(|error| error.to_string())?;
        fs::rename(&live, &staged)
            .map_err(|error| format!("Failed to stage plugin removal: {}", error))?;
    }
    if let Err(error) = commit() {
        if had_installation {
            fs::rename(&staged, &live).map_err(|restore| {
                format!(
                    "{}; previous installation remains at {:?}: {}",
                    error, staged, restore
                )
            })?;
        }
        return Err(error);
    }
    if had_installation {
        if let Err(error) = fs::remove_dir_all(&staged) {
            eprintln!(
                "Plugin removal committed; cleanup at {:?} will be retried: {}",
                staged, error
            );
        }
    }
    Ok(())
}

pub(super) fn recover_plugin_directory(
    live: &Path,
    backup: &Path,
    expected_entry: &Path,
) -> Result<(), String> {
    if expected_entry.exists() {
        if backup.exists() {
            let _ = fs::remove_dir_all(backup);
        }
        return Ok(());
    }

    if !backup.exists() {
        return Err(format!(
            "Installed plugin entry is missing and no recovery backup exists: {:?}",
            expected_entry
        ));
    }

    let displaced = temporary_sibling_path(live, "displaced")?;
    let displaced_live = if live.exists() {
        fs::rename(live, &displaced).map_err(|error| {
            format!(
                "Failed to preserve incomplete plugin installation: {}",
                error
            )
        })?;
        true
    } else {
        false
    };

    if let Err(error) = fs::rename(backup, live) {
        if displaced_live {
            let _ = fs::rename(&displaced, live);
        }
        return Err(format!(
            "Failed to recover plugin installation from {:?}: {}",
            backup, error
        ));
    }

    if displaced_live {
        let _ = fs::remove_dir_all(displaced);
    }

    if !expected_entry.exists() {
        return Err(format!(
            "Recovered plugin backup does not contain expected entry: {:?}",
            expected_entry
        ));
    }

    Ok(())
}

fn recover_plugin_installations(app: &AppHandle, store: &mut PluginStore) -> Result<(), String> {
    recover_installations_at(&plugin_install_base_dir(app)?, store)
}

pub(super) fn recover_installations_at(
    install_base: &Path,
    store: &mut PluginStore,
) -> Result<(), String> {
    for plugin in &mut store.installed_plugins {
        if !validate_plugin_id(&plugin.id) {
            return Err(format!("Installed plugin has invalid id: {}", plugin.id));
        }

        let live = install_base.join(sanitize_plugin_id(&plugin.id));
        let backup = persistent_backup_path(&live)?;
        if let Err(message) =
            recover_plugin_directory(&live, &backup, Path::new(&plugin.entry_path))
        {
            plugin.enabled = false;
            plugin.entry_source = None;
            if !plugin.diagnostics.iter().any(|item| {
                item.operation.as_deref() == Some("installation-recovery")
                    && item.message == message
            }) {
                plugin.diagnostics.push(PluginDiagnostic {
                    id: diagnostic_id(
                        &plugin.id,
                        "activation-error",
                        Some("installation-recovery"),
                    ),
                    kind: "activation-error".to_string(),
                    message,
                    occurred_at: now_iso(),
                    operation: Some("installation-recovery".to_string()),
                    count: 1,
                });
                trim_diagnostics(&mut plugin.diagnostics);
            }
            if let Some(record) = store
                .lock_records
                .iter_mut()
                .find(|record| record.plugin_id == plugin.id)
            {
                record.enabled = false;
            }
        }
    }

    Ok(())
}

pub(super) fn swap_plugin_directory(
    staged: &Path,
    live: &Path,
    backup: &Path,
) -> Result<bool, String> {
    if backup.exists() {
        return Err(format!(
            "Plugin backup already exists and must be recovered before replacement: {:?}",
            backup
        ));
    }

    let had_previous = live.exists();
    if had_previous {
        fs::rename(live, backup)
            .map_err(|error| format!("Failed to stage existing plugin installation: {}", error))?;
    }

    if let Err(error) = fs::rename(staged, live) {
        return if had_previous {
            match fs::rename(backup, live) {
                Ok(()) => Err(format!(
                    "Failed to activate staged plugin installation: {}",
                    error
                )),
                Err(restore_error) => Err(format!(
                    "Failed to activate staged plugin installation: {}; previous installation remains at {:?}, but immediate recovery failed: {}",
                    error, backup, restore_error
                )),
            }
        } else {
            Err(format!(
                "Failed to activate staged plugin installation: {}",
                error
            ))
        };
    }

    Ok(had_previous)
}

fn rollback_plugin_directory(live: &Path, backup: &Path, had_previous: bool) -> Result<(), String> {
    let displaced = temporary_sibling_path(live, "rollback")?;
    let displaced_live = if live.exists() {
        fs::rename(live, &displaced)
            .map_err(|error| format!("Failed to preserve replacement directory: {}", error))?;
        true
    } else {
        false
    };

    if had_previous {
        if let Err(error) = fs::rename(backup, live) {
            if displaced_live {
                let _ = fs::rename(&displaced, live);
            }
            return Err(format!(
                "Failed to restore previous plugin directory from {:?}: {}",
                backup, error
            ));
        }
    }

    if displaced_live {
        let _ = fs::remove_dir_all(displaced);
    }

    Ok(())
}

pub(super) fn install_plugin_from_zip_bytes(
    app: &AppHandle,
    zip_bytes: Vec<u8>,
    registry_entry: Option<&PluginRegistryEntry>,
    registry_url: Option<String>,
) -> Result<InstalledPlugin, String> {
    let (manifest, manifest_value) = inspect_plugin_archive(&zip_bytes)?;
    if let Some(entry) = registry_entry {
        validate_registry_archive_identity(entry, &manifest, &manifest_value)?;
    }

    let (install_source, trust) = if registry_entry.is_some() {
        ("registry", "verified")
    } else {
        ("sideload", "unverified")
    };
    let signature_verified = registry_entry.is_some();
    let signature_key_id = registry_entry.map(|entry| entry.signature_key_id.clone());
    let download_url = registry_entry.map(|entry| entry.download_url.clone());

    let _store_guard = lock_plugin_store()?;
    let mut store = load_store(app)?;
    let previous = store
        .installed_plugins
        .iter()
        .find(|plugin| plugin.id == manifest.id)
        .cloned();

    let install_base = plugin_install_base_dir(app)?;
    let plugin_dir = install_base.join(sanitize_plugin_id(&manifest.id));
    let version_dir = plugin_dir.join(&manifest.version);
    let staging_dir = temporary_sibling_path(&plugin_dir, "staging")?;
    let staging_version_dir = staging_dir.join(&manifest.version);
    let backup_dir = persistent_backup_path(&plugin_dir)?;

    let preparation = (|| -> Result<String, String> {
        fs::create_dir_all(&staging_version_dir)
            .map_err(|error| format!("Failed to create plugin staging directory: {}", error))?;

        let mut extraction_archive = ZipArchive::new(Cursor::new(zip_bytes.as_slice()))
            .map_err(|error| format!("Failed to re-open plugin archive: {}", error))?;
        extract_zip_to_directory(&mut extraction_archive, &staging_version_dir)?;

        let staged_entry_path = staging_version_dir.join(&manifest.entry);
        fs::read_to_string(&staged_entry_path)
            .map_err(|error| format!("Failed to read extracted plugin entry file: {}", error))
    })();

    let entry_source = match preparation {
        Ok(source) => source,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }
    };
    let final_entry_path = version_dir.join(&manifest.entry);

    let now = now_iso();

    let installed_plugin = InstalledPlugin {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        enabled: previous
            .as_ref()
            .map(|plugin| plugin.enabled)
            .unwrap_or(true),
        trust: trust.to_string(),
        install_source: install_source.to_string(),
        installed_at: previous
            .as_ref()
            .map(|plugin| plugin.installed_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now.clone(),
        entry_path: final_entry_path.to_string_lossy().to_string(),
        entry_source: Some(entry_source),
        crash_count: previous
            .as_ref()
            .map(|plugin| plugin.crash_count)
            .unwrap_or(0),
        diagnostics: previous
            .as_ref()
            .map(|plugin| plugin.diagnostics.clone())
            .unwrap_or_default(),
        network_allowlist: manifest.network_allowlist.clone(),
        granted_permissions: normalize_grants(
            &manifest,
            previous
                .as_ref()
                .map(|plugin| plugin.granted_permissions.clone())
                .unwrap_or_default(),
        ),
        manifest: manifest.clone(),
    };

    store
        .installed_plugins
        .retain(|plugin| plugin.id != manifest.id);
    store
        .lock_records
        .retain(|record| record.plugin_id != manifest.id);

    store.installed_plugins.push(installed_plugin.clone());

    let lock = PluginLockRecord {
        plugin_id: manifest.id,
        version: manifest.version,
        sha256: compute_sha256_hex(&zip_bytes),
        signature_verified,
        signature_key_id,
        install_source: Some(install_source.to_string()),
        registry_url,
        download_url,
        trust: trust.to_string(),
        enabled: installed_plugin.enabled,
        granted_permissions: installed_plugin.granted_permissions.clone(),
        updated_at: now,
    };

    store.lock_records.push(lock);

    let had_previous_directory = match swap_plugin_directory(&staging_dir, &plugin_dir, &backup_dir)
    {
        Ok(had_previous) => had_previous,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }
    };

    if let Err(save_error) = save_store(app, &store) {
        return match rollback_plugin_directory(&plugin_dir, &backup_dir, had_previous_directory) {
            Ok(()) => Err(save_error),
            Err(rollback_error) => Err(format!(
                "{}; plugin directory rollback also failed: {}",
                save_error, rollback_error
            )),
        };
    }

    if had_previous_directory {
        let _ = fs::remove_dir_all(backup_dir);
    }

    Ok(installed_plugin)
}

pub(super) fn append_audit_log(
    app: &AppHandle,
    plugin_id: &str,
    operation: &str,
    payload: &Value,
) -> Result<(), String> {
    let log_path = plugin_root(app)?.join(PLUGIN_AUDIT_LOG_FILE);
    let mut file = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(log_path)
        .map_err(|error| format!("Failed to open plugin audit log: {}", error))?;

    let line = json!({
        "timestamp": now_iso(),
        "pluginId": plugin_id,
        "operation": operation,
        "payload": payload,
    });

    writeln!(file, "{}", line)
        .map_err(|error| format!("Failed to write plugin audit log entry: {}", error))
}

pub(super) fn is_supported_diagnostic_kind(kind: &str) -> bool {
    matches!(
        kind,
        "activation-error" | "runtime-crash" | "permission-denial" | "invocation-timeout"
    )
}

pub(super) fn diagnostic_id(plugin_id: &str, kind: &str, operation: Option<&str>) -> String {
    format!(
        "{}:{}:{}:{}",
        plugin_id,
        kind,
        operation.unwrap_or("general"),
        Utc::now().timestamp_millis()
    )
}

pub(super) fn trim_diagnostics(diagnostics: &mut Vec<PluginDiagnostic>) {
    const MAX_DIAGNOSTICS_PER_PLUGIN: usize = 25;
    if diagnostics.len() <= MAX_DIAGNOSTICS_PER_PLUGIN {
        return;
    }

    let extra = diagnostics.len() - MAX_DIAGNOSTICS_PER_PLUGIN;
    diagnostics.drain(0..extra);
}
