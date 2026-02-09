use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use reqwest::Client;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

const PLUGIN_STORE_FILE: &str = "plugins-state.json";
const PLUGIN_AUDIT_LOG_FILE: &str = "plugin-audit.log";
const MANIFEST_FILE_NAME: &str = "grainery-plugin.manifest.json";
const PLUGIN_API_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifestEngine {
    pub grainery: String,
    pub plugin_api: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSignature {
    pub key_id: String,
    pub sha256: String,
    pub sig: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub engine: PluginManifestEngine,
    pub entry: String,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub optional_permissions: Vec<String>,
    #[serde(default)]
    pub network_allowlist: Vec<String>,
    #[serde(default)]
    pub signature: Option<PluginSignature>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermissionGrant {
    pub permission: String,
    pub granted: bool,
    pub granted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub trust: String,
    pub install_source: String,
    pub installed_at: String,
    pub updated_at: String,
    pub entry_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_source: Option<String>,
    pub crash_count: u32,
    #[serde(default)]
    pub network_allowlist: Vec<String>,
    pub manifest: PluginManifest,
    #[serde(default)]
    pub granted_permissions: Vec<PluginPermissionGrant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub manifest: PluginManifest,
    pub download_url: String,
    pub sha256: String,
    pub signature_key_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginLockRecord {
    pub plugin_id: String,
    pub version: String,
    pub sha256: String,
    pub signature_verified: bool,
    pub trust: String,
    pub enabled: bool,
    #[serde(default)]
    pub granted_permissions: Vec<PluginPermissionGrant>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PluginStore {
    #[serde(default)]
    installed_plugins: Vec<InstalledPlugin>,
    #[serde(default)]
    lock_records: Vec<PluginLockRecord>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
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

fn validate_plugin_id(plugin_id: &str) -> bool {
    !plugin_id.is_empty()
        && plugin_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

fn is_optional_permission(permission: &str) -> bool {
    matches!(
        permission,
        "fs:pick-read" | "fs:pick-write" | "network:https"
    )
}

fn is_core_permission(permission: &str) -> bool {
    matches!(
        permission,
        "document:read" | "document:write" | "editor:commands" | "export:register"
    )
}

fn plugin_root(app: &AppHandle) -> Result<PathBuf, String> {
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

fn load_store(app: &AppHandle) -> Result<PluginStore, String> {
    let store_path = plugin_store_path(app)?;

    if !store_path.exists() {
        return Ok(PluginStore::default());
    }

    let content = fs::read_to_string(&store_path)
        .map_err(|error| format!("Failed to read plugin store file: {}", error))?;

    serde_json::from_str::<PluginStore>(&content)
        .map_err(|error| format!("Failed to parse plugin store JSON: {}", error))
}

fn save_store(app: &AppHandle, store: &PluginStore) -> Result<(), String> {
    let store_path = plugin_store_path(app)?;
    let payload = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Failed to serialize plugin store JSON: {}", error))?;

    fs::write(store_path, payload).map_err(|error| format!("Failed to save plugin store file: {}", error))
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn read_manifest_from_zip(archive: &mut ZipArchive<Cursor<Vec<u8>>>) -> Result<PluginManifest, String> {
    let mut manifest_file = archive
        .by_name(MANIFEST_FILE_NAME)
        .map_err(|_| format!("Plugin archive missing {}", MANIFEST_FILE_NAME))?;

    let mut manifest_json = String::new();
    manifest_file
        .read_to_string(&mut manifest_json)
        .map_err(|error| format!("Failed to read plugin manifest: {}", error))?;

    serde_json::from_str::<PluginManifest>(&manifest_json)
        .map_err(|error| format!("Failed to parse plugin manifest JSON: {}", error))
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err("Unsupported manifest schemaVersion. Expected 1".to_string());
    }

    if !validate_plugin_id(&manifest.id) {
        return Err("Invalid plugin id. Only [a-zA-Z0-9._-] are allowed".to_string());
    }

    if manifest.name.trim().is_empty() {
        return Err("Plugin name is required".to_string());
    }

    Version::parse(&manifest.version)
        .map_err(|error| format!("Plugin version must be valid semver: {}", error))?;

    if manifest.entry.trim().is_empty() {
        return Err("Plugin entry path is required".to_string());
    }

    if manifest.entry.contains("..") || Path::new(&manifest.entry).is_absolute() {
        return Err("Plugin entry path must be a relative path within the archive".to_string());
    }

    let current_version = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|error| format!("Failed to parse app version: {}", error))?;
    let grainery_req = VersionReq::parse(&manifest.engine.grainery)
        .map_err(|error| format!("Invalid engine.grainery version requirement: {}", error))?;

    if !grainery_req.matches(&current_version) {
        return Err(format!(
            "Plugin engine mismatch. Requires Grainery {}, current version is {}",
            manifest.engine.grainery,
            current_version
        ));
    }

    let plugin_api_version = Version::parse(PLUGIN_API_VERSION)
        .map_err(|error| format!("Failed to parse plugin API version: {}", error))?;
    let plugin_api_req = VersionReq::parse(&manifest.engine.plugin_api)
        .map_err(|error| format!("Invalid engine.pluginApi version requirement: {}", error))?;

    if !plugin_api_req.matches(&plugin_api_version) {
        return Err(format!(
            "Plugin API mismatch. Requires {}, current API version is {}",
            manifest.engine.plugin_api,
            plugin_api_version
        ));
    }

    for permission in &manifest.permissions {
        if !is_core_permission(permission) {
            return Err(format!("Unknown core permission: {}", permission));
        }
    }

    for permission in &manifest.optional_permissions {
        if !is_optional_permission(permission) {
            return Err(format!("Unknown optional permission: {}", permission));
        }
    }

    Ok(())
}

fn extract_zip_to_directory(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    destination: &Path,
) -> Result<(), String> {
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read archive entry {}: {}", index, error))?;

        let enclosed = file
            .enclosed_name()
            .map(|path| path.to_path_buf())
            .ok_or_else(|| format!("Archive entry contains invalid path: {}", file.name()))?;

        let output_path = destination.join(enclosed);

        if file.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Failed to create plugin directory: {}", error))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create plugin parent directory: {}", error))?;
        }

        let mut output_file = fs::File::create(&output_path)
            .map_err(|error| format!("Failed to create plugin file {:?}: {}", output_path, error))?;
        std::io::copy(&mut file, &mut output_file)
            .map_err(|error| format!("Failed to write plugin file {:?}: {}", output_path, error))?;

        output_file
            .flush()
            .map_err(|error| format!("Failed to flush plugin file {:?}: {}", output_path, error))?;
    }

    Ok(())
}

fn trusted_registry_keys() -> HashMap<&'static str, &'static str> {
    HashMap::from([(
        "main-2026",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    )])
}

fn verify_registry_signature(
    signature_key_id: &str,
    signature_b64: &str,
    sha256_hex: &str,
) -> Result<(), String> {
    let keys = trusted_registry_keys();
    let key_b64 = keys.get(signature_key_id).ok_or_else(|| {
        format!(
            "Unknown signature key id: {} (expected trusted curated key)",
            signature_key_id
        )
    })?;

    let key_bytes = BASE64_STANDARD
        .decode(key_b64)
        .map_err(|error| format!("Invalid trusted public key encoding: {}", error))?;

    let signature_bytes = BASE64_STANDARD
        .decode(signature_b64)
        .map_err(|error| format!("Invalid signature encoding: {}", error))?;

    let key_array: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| "Trusted key must decode to 32 bytes".to_string())?;

    let signature_array: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| "Signature must decode to 64 bytes".to_string())?;

    let verifying_key = VerifyingKey::from_bytes(&key_array)
        .map_err(|error| format!("Failed to parse trusted public key: {}", error))?;
    let signature = Signature::from_bytes(&signature_array);

    verifying_key
        .verify(sha256_hex.as_bytes(), &signature)
        .map_err(|error| format!("Signature verification failed: {}", error))
}

fn normalize_grants(manifest: &PluginManifest, grants: Vec<PluginPermissionGrant>) -> Vec<PluginPermissionGrant> {
    let mut output = Vec::new();

    for optional in &manifest.optional_permissions {
        let found = grants.iter().find(|item| item.permission == *optional);

        if let Some(grant) = found {
            output.push(PluginPermissionGrant {
                permission: optional.clone(),
                granted: grant.granted,
                granted_at: grant.granted_at.clone(),
            });
        } else {
            output.push(PluginPermissionGrant {
                permission: optional.clone(),
                granted: false,
                granted_at: None,
            });
        }
    }

    output
}

fn has_permission(plugin: &InstalledPlugin, permission: &str) -> bool {
    if plugin
        .manifest
        .permissions
        .iter()
        .any(|item| item == permission)
    {
        return true;
    }

    plugin
        .granted_permissions
        .iter()
        .any(|grant| grant.permission == permission && grant.granted)
}

fn hydrate_entry_source(plugin: &mut InstalledPlugin) {
    if !plugin.enabled {
        plugin.entry_source = None;
        return;
    }

    let source = fs::read_to_string(&plugin.entry_path).ok();
    plugin.entry_source = source;
}

fn remove_plugin_installation(app: &AppHandle, plugin_id: &str) -> Result<(), String> {
    let install_base = plugin_install_base_dir(app)?;
    let plugin_dir = install_base.join(sanitize_plugin_id(plugin_id));

    if plugin_dir.exists() {
        fs::remove_dir_all(plugin_dir)
            .map_err(|error| format!("Failed to remove plugin directory: {}", error))?;
    }

    Ok(())
}

fn install_plugin_from_zip_bytes(
    app: &AppHandle,
    zip_bytes: Vec<u8>,
    install_source: &str,
    trust: &str,
    signature_verified: bool,
) -> Result<InstalledPlugin, String> {
    let cursor = Cursor::new(zip_bytes.clone());
    let mut archive = ZipArchive::new(cursor)
        .map_err(|error| format!("Failed to parse plugin archive: {}", error))?;

    let manifest = read_manifest_from_zip(&mut archive)?;
    validate_manifest(&manifest)?;

    let install_base = plugin_install_base_dir(app)?;
    let plugin_dir = install_base.join(sanitize_plugin_id(&manifest.id));
    let version_dir = plugin_dir.join(&manifest.version);

    remove_plugin_installation(app, &manifest.id)?;

    fs::create_dir_all(&version_dir)
        .map_err(|error| format!("Failed to create plugin version directory: {}", error))?;

    let mut extraction_archive = ZipArchive::new(Cursor::new(zip_bytes.clone()))
        .map_err(|error| format!("Failed to re-open plugin archive: {}", error))?;
    extract_zip_to_directory(&mut extraction_archive, &version_dir)?;

    let final_entry_path = version_dir.join(&manifest.entry);
    if !final_entry_path.exists() {
        return Err(format!(
            "Plugin entry file does not exist after extraction: {}",
            manifest.entry
        ));
    }

    let entry_source = fs::read_to_string(&final_entry_path)
        .map_err(|error| format!("Failed to read extracted plugin entry file: {}", error))?;

    let mut store = load_store(app)?;

    let now = now_iso();

    let installed_plugin = InstalledPlugin {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        enabled: true,
        trust: trust.to_string(),
        install_source: install_source.to_string(),
        installed_at: now.clone(),
        updated_at: now.clone(),
        entry_path: final_entry_path.to_string_lossy().to_string(),
        entry_source: Some(entry_source),
        crash_count: 0,
        network_allowlist: manifest.network_allowlist.clone(),
        granted_permissions: normalize_grants(&manifest, Vec::new()),
        manifest: manifest.clone(),
    };

    store.installed_plugins.retain(|plugin| plugin.id != manifest.id);
    store
        .lock_records
        .retain(|record| record.plugin_id != manifest.id);

    store.installed_plugins.push(installed_plugin.clone());

    let lock = PluginLockRecord {
        plugin_id: manifest.id,
        version: manifest.version,
        sha256: compute_sha256_hex(&zip_bytes),
        signature_verified,
        trust: trust.to_string(),
        enabled: true,
        granted_permissions: installed_plugin.granted_permissions.clone(),
        updated_at: now,
    };

    store.lock_records.push(lock);

    save_store(app, &store)?;

    Ok(installed_plugin)
}

async fn fetch_registry_entries(registry_url: &str) -> Result<Vec<PluginRegistryEntry>, String> {
    let client = Client::new();
    let response = client
        .get(registry_url)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch registry index: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Registry request failed with HTTP status {}",
            response.status()
        ));
    }

    let raw_json = response
        .text()
        .await
        .map_err(|error| format!("Failed to read registry response body: {}", error))?;

    let value: Value = serde_json::from_str(&raw_json)
        .map_err(|error| format!("Failed to parse registry JSON: {}", error))?;

    if let Some(array) = value.as_array() {
        return serde_json::from_value(Value::Array(array.clone()))
            .map_err(|error| format!("Failed to parse registry entries: {}", error));
    }

    if let Some(plugins) = value.get("plugins") {
        return serde_json::from_value(plugins.clone())
            .map_err(|error| format!("Failed to parse registry plugins array: {}", error));
    }

    Err("Registry JSON must be an array or contain a 'plugins' array".to_string())
}

fn select_registry_entry(
    entries: &[PluginRegistryEntry],
    plugin_id: &str,
    version: Option<&str>,
) -> Result<PluginRegistryEntry, String> {
    let mut matches = entries
        .iter()
        .filter(|entry| entry.id == plugin_id)
        .cloned()
        .collect::<Vec<_>>();

    if matches.is_empty() {
        return Err(format!("Plugin '{}' not found in registry index", plugin_id));
    }

    if let Some(version) = version {
        let exact = matches
            .into_iter()
            .find(|entry| entry.version == version)
            .ok_or_else(|| {
                format!(
                    "Plugin '{}' version '{}' not found in registry index",
                    plugin_id, version
                )
            })?;

        return Ok(exact);
    }

    matches.sort_by(|a, b| {
        let left = Version::parse(&a.version).ok();
        let right = Version::parse(&b.version).ok();

        match (left, right) {
            (Some(left), Some(right)) => left.cmp(&right),
            _ => a.version.cmp(&b.version),
        }
    });

    matches
        .pop()
        .ok_or_else(|| format!("No installable version found for plugin '{}'", plugin_id))
}

fn enforce_network_allowlist(plugin: &InstalledPlugin, url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|error| format!("Invalid URL '{}': {}", url, error))?;

    if parsed.scheme() != "https" {
        return Err("Only https:// URLs are allowed for plugin network calls".to_string());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL is missing a host".to_string())?;

    if plugin.network_allowlist.is_empty() {
        return Err("Plugin has an empty network allowlist".to_string());
    }

    if !plugin
        .network_allowlist
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(host))
    {
        return Err(format!(
            "Host '{}' is not in plugin allowlist ({})",
            host,
            plugin.network_allowlist.join(", ")
        ));
    }

    Ok(())
}

fn append_audit_log(app: &AppHandle, plugin_id: &str, operation: &str, payload: &Value) -> Result<(), String> {
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

#[tauri::command]
pub fn plugin_list_installed(app: AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let mut store = load_store(&app)?;

    for plugin in &mut store.installed_plugins {
        hydrate_entry_source(plugin);
    }

    Ok(store.installed_plugins)
}

#[tauri::command]
pub fn plugin_get_lock_records(app: AppHandle) -> Result<Vec<PluginLockRecord>, String> {
    let store = load_store(&app)?;
    Ok(store.lock_records)
}

#[tauri::command]
pub fn plugin_install_from_file(app: AppHandle, path: String) -> Result<InstalledPlugin, String> {
    let zip_bytes = fs::read(&path)
        .map_err(|error| format!("Failed to read plugin archive '{}': {}", path, error))?;

    install_plugin_from_zip_bytes(&app, zip_bytes, "sideload", "unverified", false)
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
) -> Result<InstalledPlugin, String> {
    let entries = fetch_registry_entries(&registry_url).await?;
    let selected = select_registry_entry(&entries, &plugin_id, version.as_deref())?;

    if selected.manifest.id != selected.id {
        return Err("Registry manifest id does not match registry entry id".to_string());
    }

    if selected.manifest.version != selected.version {
        return Err("Registry manifest version does not match registry entry version".to_string());
    }

    validate_manifest(&selected.manifest)?;

    verify_registry_signature(
        &selected.signature_key_id,
        &selected.signature,
        &selected.sha256,
    )?;

    let client = Client::new();
    let response = client
        .get(&selected.download_url)
        .send()
        .await
        .map_err(|error| format!("Failed to download plugin archive: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Plugin download failed with HTTP status {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read plugin download response: {}", error))?;

    let zip_bytes = bytes.to_vec();
    let computed_sha256 = compute_sha256_hex(&zip_bytes);

    if !computed_sha256.eq_ignore_ascii_case(&selected.sha256) {
        return Err(format!(
            "SHA256 mismatch for downloaded plugin archive. Expected {}, got {}",
            selected.sha256, computed_sha256
        ));
    }

    install_plugin_from_zip_bytes(&app, zip_bytes, "registry", "verified", true)
}

#[tauri::command]
pub fn plugin_uninstall(app: AppHandle, plugin_id: String) -> Result<(), String> {
    if !validate_plugin_id(&plugin_id) {
        return Err("Invalid plugin id".to_string());
    }

    let mut store = load_store(&app)?;

    let before_count = store.installed_plugins.len();
    store.installed_plugins.retain(|plugin| plugin.id != plugin_id);
    store
        .lock_records
        .retain(|record| record.plugin_id != plugin_id);

    if before_count == store.installed_plugins.len() {
        return Err(format!("Plugin '{}' is not installed", plugin_id));
    }

    remove_plugin_installation(&app, &plugin_id)?;
    save_store(&app, &store)?;

    Ok(())
}

#[tauri::command]
pub fn plugin_enable_disable(
    app: AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<InstalledPlugin, String> {
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
}

#[tauri::command]
pub fn plugin_update_permissions(
    app: AppHandle,
    plugin_id: String,
    permissions: Vec<PluginPermissionGrant>,
) -> Result<InstalledPlugin, String> {
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
            return Err(format!("Unsupported permission '{}'", permission.permission));
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
}

#[tauri::command]
pub async fn plugin_host_call(
    app: AppHandle,
    plugin_id: String,
    operation: String,
    payload: Value,
) -> Result<Value, String> {
    let store = load_store(&app)?;
    let plugin = store
        .installed_plugins
        .iter()
        .find(|plugin| plugin.id == plugin_id)
        .ok_or_else(|| format!("Plugin '{}' is not installed", plugin_id))?;

    if !plugin.enabled {
        return Err(format!("Plugin '{}' is disabled", plugin_id));
    }

    append_audit_log(&app, &plugin_id, &operation, &payload)?;

    match operation.as_str() {
        "network:get_json" => {
            if !has_permission(plugin, "network:https") {
                return Err("Permission denied: network:https".to_string());
            }

            let url = payload
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "Payload must include string field 'url'".to_string())?;

            enforce_network_allowlist(plugin, url)?;

            let response = Client::new()
                .get(url)
                .send()
                .await
                .map_err(|error| format!("Network request failed: {}", error))?;

            if !response.status().is_success() {
                return Err(format!("HTTP request failed with status {}", response.status()));
            }

            response
                .json::<Value>()
                .await
                .map_err(|error| format!("Failed to parse JSON response: {}", error))
        }

        "network:get_text" => {
            if !has_permission(plugin, "network:https") {
                return Err("Permission denied: network:https".to_string());
            }

            let url = payload
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "Payload must include string field 'url'".to_string())?;

            enforce_network_allowlist(plugin, url)?;

            let response = Client::new()
                .get(url)
                .send()
                .await
                .map_err(|error| format!("Network request failed: {}", error))?;

            if !response.status().is_success() {
                return Err(format!("HTTP request failed with status {}", response.status()));
            }

            let body = response
                .text()
                .await
                .map_err(|error| format!("Failed to read text response: {}", error))?;

            Ok(json!({ "text": body }))
        }

        "audit:log" => Ok(json!({ "ok": true })),

        "document:get" | "document:replace" => Err(
            "Document operations must be brokered by the frontend host, not plugin_host_call"
                .to_string(),
        ),

        _ => Err(format!("Unsupported host operation '{}'", operation)),
    }
}
