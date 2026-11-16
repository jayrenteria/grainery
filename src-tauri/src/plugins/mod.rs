mod archive;
mod manifest;
mod registry;
mod store;
#[cfg(test)]
mod tests;
mod types;

use crate::fonts;
use archive::{read_to_end_bounded, MAX_PLUGIN_ARCHIVE_BYTES};
use manifest::{has_permission, is_optional_permission, normalize_grants, validate_plugin_id};
use registry::{
    compute_sha256_hex, decode_plugin_body, fetch_plugin_body, fetch_registry_entries,
    is_official_package_url, is_official_registry_url, package_http_client, plugin_http_client,
    read_response_body_bounded, select_registry_entry, validate_network_url,
    validate_registry_entry, verify_registry_signature,
};
use serde_json::{json, Value};
use std::fs;
use store::{
    append_audit_log, diagnostic_id, hydrate_entry_source, install_plugin_from_zip_bytes,
    is_supported_diagnostic_kind, load_store, lock_plugin_store, now_iso, plugin_root, save_store,
    trim_diagnostics, uninstall_with_commit,
};
use tauri::AppHandle;
pub(super) use types::*;

#[tauri::command]
pub async fn plugin_list_installed(app: AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    crate::run_blocking(move || {
        let _store_guard = lock_plugin_store()?;
        let mut store = load_store(&app)?;

        for plugin in &mut store.installed_plugins {
            hydrate_entry_source(plugin);
        }

        Ok(store.installed_plugins)
    })
    .await
}

#[tauri::command]
pub async fn plugin_get_lock_records(app: AppHandle) -> Result<Vec<PluginLockRecord>, String> {
    crate::run_blocking(move || {
        let _store_guard = lock_plugin_store()?;
        let store = load_store(&app)?;
        Ok(store.lock_records)
    })
    .await
}

#[tauri::command]
pub async fn plugin_install_from_file(
    app: AppHandle,
    path: String,
) -> Result<InstalledPlugin, String> {
    crate::run_blocking(move || {
        let mut file = fs::File::open(&path)
            .map_err(|error| format!("Failed to open plugin archive '{}': {}", path, error))?;
        let zip_bytes = read_to_end_bounded(&mut file, MAX_PLUGIN_ARCHIVE_BYTES, "plugin archive")?;

        install_plugin_from_zip_bytes(&app, zip_bytes, None, None)
    })
    .await
}

#[tauri::command]
pub async fn plugin_fetch_registry_index(
    registry_url: String,
) -> Result<Vec<PluginRegistryEntry>, String> {
    fetch_registry_entries(&registry_url).await
}

#[tauri::command]
pub async fn plugin_install_from_registry(
    app: AppHandle,
    registry_url: String,
    plugin_id: String,
    version: Option<String>,
    expected_entry: Option<PluginRegistryEntry>,
) -> Result<InstalledPlugin, String> {
    if !validate_plugin_id(&plugin_id) {
        return Err("Invalid plugin id. Expected lowercase [a-z0-9._-]".to_string());
    }

    let official_registry = is_official_registry_url(&registry_url);
    let entries = fetch_registry_entries(&registry_url).await?;
    let selected = select_registry_entry(&entries, &plugin_id, version.as_deref())?;

    validate_registry_entry(&selected)?;
    if expected_entry
        .as_ref()
        .is_some_and(|expected| expected != &selected)
    {
        return Err(
            "Registry entry changed after confirmation; review the plugin again before installing"
                .to_string(),
        );
    }
    let selected_download_url = reqwest::Url::parse(&selected.download_url)
        .map_err(|error| format!("Invalid registry download URL: {}", error))?;
    if official_registry && !is_official_package_url(&selected_download_url, &selected) {
        return Err(format!(
            "Official registry package URL is outside the immutable package path: {}",
            selected.download_url
        ));
    }

    verify_registry_signature(
        &selected.signature_key_id,
        &selected.signature,
        &selected.sha256,
    )?;

    let client = package_http_client()?;
    let response = client
        .get(&selected.download_url)
        .send()
        .await
        .map_err(|error| format!("Failed to download plugin archive: {}", error))?;

    if response.url().scheme() != "https" {
        return Err(format!(
            "Plugin package resolved to a non-HTTPS URL: {}",
            response.url()
        ));
    }
    if official_registry && !is_official_package_url(response.url(), &selected) {
        return Err(format!(
            "Official plugin package redirected outside its immutable package path: {}",
            response.url()
        ));
    }

    if !response.status().is_success() {
        return Err(format!(
            "Plugin download failed with HTTP status {}",
            response.status()
        ));
    }

    let zip_bytes = read_response_body_bounded(
        response,
        MAX_PLUGIN_ARCHIVE_BYTES,
        "plugin download response",
    )
    .await?;
    crate::run_blocking(move || {
        let computed_sha256 = compute_sha256_hex(&zip_bytes);

        if computed_sha256 != selected.sha256 {
            return Err(format!(
                "SHA256 mismatch for downloaded plugin archive. Expected {}, got {}",
                selected.sha256, computed_sha256
            ));
        }

        install_plugin_from_zip_bytes(&app, zip_bytes, Some(&selected), Some(registry_url))
    })
    .await
}

#[tauri::command]
pub async fn plugin_uninstall(app: AppHandle, plugin_id: String) -> Result<(), String> {
    crate::run_blocking(move || {
        if !validate_plugin_id(&plugin_id) {
            return Err("Invalid plugin id".to_string());
        }

        let _store_guard = lock_plugin_store()?;
        let mut store = load_store(&app)?;

        let before_count = store.installed_plugins.len();
        store
            .installed_plugins
            .retain(|plugin| plugin.id != plugin_id);
        store
            .lock_records
            .retain(|record| record.plugin_id != plugin_id);

        if before_count == store.installed_plugins.len() {
            return Err(format!("Plugin '{}' is not installed", plugin_id));
        }

        uninstall_with_commit(&plugin_root(&app)?, &plugin_id, || save_store(&app, &store))
    })
    .await
}

#[tauri::command]
pub async fn plugin_enable_disable(
    app: AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<InstalledPlugin, String> {
    crate::run_blocking(move || {
        let _store_guard = lock_plugin_store()?;
        let mut store = load_store(&app)?;

        let plugin = store
            .installed_plugins
            .iter_mut()
            .find(|plugin| plugin.id == plugin_id)
            .ok_or_else(|| format!("Plugin '{}' is not installed", plugin_id))?;

        plugin.enabled = enabled;
        plugin.updated_at = now_iso();

        let lock = store
            .lock_records
            .iter_mut()
            .find(|record| record.plugin_id == plugin_id);

        if let Some(lock) = lock {
            lock.enabled = enabled;
            lock.updated_at = plugin.updated_at.clone();
        }

        let mut output = plugin.clone();
        hydrate_entry_source(&mut output);

        save_store(&app, &store)?;

        Ok(output)
    })
    .await
}

#[tauri::command]
pub async fn plugin_update_permissions(
    app: AppHandle,
    plugin_id: String,
    permissions: Vec<PluginPermissionGrant>,
) -> Result<InstalledPlugin, String> {
    crate::run_blocking(move || {
        let _store_guard = lock_plugin_store()?;
        let mut store = load_store(&app)?;

        let plugin = store
            .installed_plugins
            .iter_mut()
            .find(|plugin| plugin.id == plugin_id)
            .ok_or_else(|| format!("Plugin '{}' is not installed", plugin_id))?;

        for permission in &permissions {
            if !plugin
                .manifest
                .optional_permissions
                .iter()
                .any(|item| item == &permission.permission)
            {
                return Err(format!(
                    "Permission '{}' is not declared as optional by plugin '{}'",
                    permission.permission, plugin_id
                ));
            }

            if !is_optional_permission(&permission.permission) {
                return Err(format!(
                    "Unsupported permission '{}'",
                    permission.permission
                ));
            }
        }

        plugin.granted_permissions = normalize_grants(&plugin.manifest, permissions);
        plugin.updated_at = now_iso();

        if let Some(lock) = store
            .lock_records
            .iter_mut()
            .find(|record| record.plugin_id == plugin_id)
        {
            lock.granted_permissions = plugin.granted_permissions.clone();
            lock.updated_at = plugin.updated_at.clone();
        }

        let mut output = plugin.clone();
        hydrate_entry_source(&mut output);

        save_store(&app, &store)?;

        Ok(output)
    })
    .await
}

#[tauri::command]
pub async fn plugin_record_diagnostic(
    app: AppHandle,
    plugin_id: String,
    diagnostic: PluginDiagnosticInput,
) -> Result<InstalledPlugin, String> {
    crate::run_blocking(move || {
        if !validate_plugin_id(&plugin_id) {
            return Err("Invalid plugin id".to_string());
        }

        if !is_supported_diagnostic_kind(&diagnostic.kind) {
            return Err(format!(
                "Unsupported plugin diagnostic kind '{}'",
                diagnostic.kind
            ));
        }

        let _store_guard = lock_plugin_store()?;
        let mut store = load_store(&app)?;
        let plugin = store
            .installed_plugins
            .iter_mut()
            .find(|plugin| plugin.id == plugin_id)
            .ok_or_else(|| format!("Plugin '{}' is not installed", plugin_id))?;

        let now = now_iso();
        let next_count = if diagnostic.kind == "runtime-crash" {
            plugin.crash_count = plugin.crash_count.saturating_add(1);
            plugin.crash_count
        } else {
            plugin
                .diagnostics
                .iter()
                .rev()
                .find(|item| item.kind == diagnostic.kind && item.operation == diagnostic.operation)
                .map(|item| item.count.saturating_add(1))
                .unwrap_or(1)
        };

        plugin.diagnostics.push(PluginDiagnostic {
            id: diagnostic_id(
                &plugin_id,
                &diagnostic.kind,
                diagnostic.operation.as_deref(),
            ),
            kind: diagnostic.kind,
            message: diagnostic.message,
            occurred_at: now.clone(),
            operation: diagnostic.operation,
            count: next_count,
        });
        trim_diagnostics(&mut plugin.diagnostics);
        plugin.updated_at = now.clone();

        if let Some(lock) = store
            .lock_records
            .iter_mut()
            .find(|record| record.plugin_id == plugin_id)
        {
            lock.updated_at = now;
        }

        let mut output = plugin.clone();
        hydrate_entry_source(&mut output);

        save_store(&app, &store)?;

        Ok(output)
    })
    .await
}

#[tauri::command]
pub async fn plugin_clear_diagnostics(
    app: AppHandle,
    plugin_id: String,
) -> Result<InstalledPlugin, String> {
    crate::run_blocking(move || {
        if !validate_plugin_id(&plugin_id) {
            return Err("Invalid plugin id".to_string());
        }

        let _store_guard = lock_plugin_store()?;
        let mut store = load_store(&app)?;
        let plugin = store
            .installed_plugins
            .iter_mut()
            .find(|plugin| plugin.id == plugin_id)
            .ok_or_else(|| format!("Plugin '{}' is not installed", plugin_id))?;

        plugin.diagnostics.clear();
        plugin.crash_count = 0;
        plugin.updated_at = now_iso();

        if let Some(lock) = store
            .lock_records
            .iter_mut()
            .find(|record| record.plugin_id == plugin_id)
        {
            lock.updated_at = plugin.updated_at.clone();
        }

        let mut output = plugin.clone();
        hydrate_entry_source(&mut output);

        save_store(&app, &store)?;

        Ok(output)
    })
    .await
}

#[tauri::command]
pub async fn plugin_host_call(
    app: AppHandle,
    plugin_id: String,
    operation: String,
    payload: Value,
) -> Result<Value, String> {
    let audit_operation = operation.clone();
    let audit_payload = payload.clone();
    let plugin = crate::run_blocking(move || {
        let _store_guard = lock_plugin_store()?;
        let store = load_store(&app)?;
        let plugin = store
            .installed_plugins
            .into_iter()
            .find(|plugin| plugin.id == plugin_id)
            .ok_or_else(|| format!("Plugin '{}' is not installed", plugin_id))?;
        if !plugin.enabled {
            return Err(format!("Plugin '{}' is disabled", plugin_id));
        }
        append_audit_log(&app, &plugin_id, &audit_operation, &audit_payload)?;
        Ok(plugin)
    })
    .await?;

    match operation.as_str() {
        "network:get_json" | "network:get_text" => {
            if !has_permission(&plugin, "network:https") {
                return Err("Permission denied: network:https".to_string());
            }
            let url = payload
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "Payload must include string field 'url'".to_string())?;
            let parsed =
                reqwest::Url::parse(url).map_err(|error| format!("Invalid URL: {}", error))?;
            validate_network_url(&plugin.network_allowlist, &parsed)?;
            let client = plugin_http_client(plugin.network_allowlist.clone())?;
            let body = fetch_plugin_body(&client, parsed.as_str()).await?;
            decode_plugin_body(&body, operation == "network:get_json")
        }

        "audit:log" => Ok(json!({ "ok": true })),

        "system:list_fonts" => {
            if !has_permission(&plugin, "system:fonts") {
                return Err("Permission denied: system:fonts".to_string());
            }

            crate::run_blocking(move || {
                let families = fonts::list_system_font_families()
                    .into_iter()
                    .map(|family| {
                        json!({
                            "name": family.name,
                            "variants": family.variants.into_iter().map(|variant| {
                                json!({
                                    "name": variant.name,
                                    "weight": variant.weight,
                                    "style": variant.style,
                                })
                            }).collect::<Vec<_>>(),
                        })
                    })
                    .collect::<Vec<_>>();

                Ok(json!({ "families": families }))
            })
            .await
        }

        "document:get" | "document:replace" => Err(
            "Document operations must be brokered by the frontend host, not plugin_host_call"
                .to_string(),
        ),

        _ => Err(format!("Unsupported host operation '{}'", operation)),
    }
}
