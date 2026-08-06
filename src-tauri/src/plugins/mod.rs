use crate::fonts;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use reqwest::redirect::Policy;
use reqwest::Client;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use zip::{CompressionMethod, ZipArchive};

const PLUGIN_STORE_FILE: &str = "plugins-state.json";
const PLUGIN_AUDIT_LOG_FILE: &str = "plugin-audit.log";
const MANIFEST_FILE_NAME: &str = "grainery-plugin.manifest.json";
const PLUGIN_API_VERSION: &str = "1.2.0";
const REQUIRED_PLUGIN_API_RANGE: &str = "^1.2.0";
const OFFICIAL_REGISTRY_URL: &str = "https://plugins.grainery.xyz/registry/v1/index.json";
const OFFICIAL_PACKAGE_HOST: &str = "plugins.grainery.xyz";
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const HTTP_TOTAL_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REGISTRY_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_PLUGIN_ARCHIVE_BYTES: usize = 10 * 1024 * 1024;
const MAX_PLUGIN_UNCOMPRESSED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_PLUGIN_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_PLUGIN_ARCHIVE_ENTRIES: usize = 256;
const MAX_PLUGIN_MANIFEST_BYTES: u64 = 256 * 1024;
static TEMP_PATH_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static PLUGIN_STORE_LOCK: Mutex<()> = Mutex::new(());

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginContributions {
    #[serde(default)]
    pub commands: Vec<ContributedCommand>,
    #[serde(default)]
    pub menus: Vec<ContributedCommandMenu>,
    #[serde(default)]
    pub keybindings: Vec<ContributedKeybinding>,
    #[serde(default)]
    pub configuration: Option<ContributedConfiguration>,
    #[serde(default)]
    pub exporters: Vec<ContributedExporter>,
    #[serde(default)]
    pub importers: Vec<ContributedImporter>,
    #[serde(default)]
    pub status_badges: Vec<ContributedStatusBadge>,
    #[serde(default)]
    pub inline_annotation_providers: Vec<ContributedInlineAnnotationProvider>,
    #[serde(default)]
    pub editor_completion_providers: Vec<ContributedEditorProvider>,
    #[serde(default)]
    pub editor_landmark_providers: Vec<ContributedEditorProvider>,
    #[serde(default)]
    pub ui_controls: Vec<ContributedUiControl>,
    #[serde(default)]
    pub ui_panels: Vec<ContributedUiPanel>,
    #[serde(default)]
    pub transforms: Vec<ContributedTransform>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedCommand {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub shortcut: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedCommandMenu {
    pub id: String,
    pub command: String,
    pub location: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedKeybinding {
    pub id: String,
    pub command: String,
    pub key: String,
    #[serde(default)]
    pub mac: Option<String>,
    #[serde(default)]
    pub windows: Option<String>,
    #[serde(default)]
    pub linux: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedConfiguration {
    #[serde(default)]
    pub title: Option<String>,
    pub properties: Vec<ContributedConfigurationProperty>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedConfigurationProperty {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub property_type: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default, rename = "enum")]
    pub enum_values: Option<Vec<String>>,
    #[serde(default)]
    pub minimum: Option<f64>,
    #[serde(default)]
    pub maximum: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedExporter {
    pub id: String,
    pub title: String,
    pub extension: String,
    #[serde(default)]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedImporter {
    pub id: String,
    pub title: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedStatusBadge {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub priority: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedInlineAnnotationProvider {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedEditorProvider {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedUiControl {
    pub id: String,
    pub mount: String,
    pub kind: String,
    pub label: String,
    pub icon: String,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub tooltip: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub hotkey_hint: Option<String>,
    #[serde(default)]
    pub action: Option<Value>,
    #[serde(default)]
    pub when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedUiPanel {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub default_width: Option<i64>,
    #[serde(default)]
    pub min_width: Option<i64>,
    #[serde(default)]
    pub max_width: Option<i64>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(default)]
    pub when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributedTransform {
    pub id: String,
    pub hook: String,
    #[serde(default)]
    pub priority: Option<i64>,
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
    pub activation_events: Vec<String>,
    #[serde(default)]
    pub contributes: PluginContributions,
    #[serde(default)]
    pub enabled_api_proposals: Vec<String>,
    #[serde(default)]
    pub permission_rationales: HashMap<String, String>,
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
pub struct PluginDiagnostic {
    pub id: String,
    pub kind: String,
    pub message: String,
    pub occurred_at: String,
    #[serde(default)]
    pub operation: Option<String>,
    #[serde(default)]
    pub count: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDiagnosticInput {
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub operation: Option<String>,
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
    pub diagnostics: Vec<PluginDiagnostic>,
    #[serde(default)]
    pub network_allowlist: Vec<String>,
    pub manifest: PluginManifest,
    #[serde(default)]
    pub granted_permissions: Vec<PluginPermissionGrant>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub manifest: Value,
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
    #[serde(default)]
    pub signature_key_id: Option<String>,
    #[serde(default)]
    pub install_source: Option<String>,
    #[serde(default)]
    pub registry_url: Option<String>,
    #[serde(default)]
    pub download_url: Option<String>,
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

fn lock_plugin_store() -> Result<MutexGuard<'static, ()>, String> {
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

fn validate_plugin_id(plugin_id: &str) -> bool {
    !plugin_id.is_empty()
        && plugin_id.len() <= 64
        && plugin_id != "."
        && plugin_id != ".."
        && plugin_id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
}

fn is_optional_permission(permission: &str) -> bool {
    matches!(
        permission,
        "fs:pick-read"
            | "fs:pick-write"
            | "network:https"
            | "ui:mount"
            | "editor:annotations"
            | "system:fonts"
    )
}

fn is_core_permission(permission: &str) -> bool {
    matches!(
        permission,
        "document:read" | "document:write" | "editor:commands" | "export:register"
    )
}

fn validate_local_contribution_id(id: &str) -> bool {
    !id.is_empty()
        && !id.contains(':')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

fn is_supported_transform_hook(hook: &str) -> bool {
    matches!(hook, "post-open" | "pre-save" | "pre-export")
}

fn is_supported_menu_location(location: &str) -> bool {
    matches!(
        location,
        "command-palette" | "main-menu" | "editor-context" | "toolbar-overflow"
    )
}

fn is_supported_ui_mount(mount: &str) -> bool {
    matches!(mount, "top-bar" | "bottom-bar" | "editor-floating")
}

fn is_supported_ui_kind(kind: &str) -> bool {
    matches!(kind, "button" | "toggle" | "segmented")
}

fn is_supported_builtin_icon(icon: &str) -> bool {
    matches!(
        icon,
        "scene-heading"
            | "action"
            | "character"
            | "dialogue"
            | "parenthetical"
            | "transition"
            | "comic-page"
            | "comic-panel"
            | "caption"
            | "sound-effect"
            | "chevron-left"
            | "chevron-right"
            | "panel"
            | "close"
            | "settings"
            | "spark"
            | "command"
            | "keyboard"
            | "template"
            | "title-page"
            | "export"
            | "diagnostics"
            | "warning"
            | "check"
            | "info"
    )
}

fn is_supported_configuration_type(property_type: &str) -> bool {
    matches!(property_type, "string" | "number" | "boolean" | "enum")
}

fn is_valid_activation_event(event: &str) -> bool {
    if event == "onStartup" {
        return true;
    }

    const PREFIXES: [&str; 7] = [
        "onCommand:",
        "onExporter:",
        "onImporter:",
        "onUIControl:",
        "onUIPanel:",
        "onStatusBadge:",
        "onInlineAnnotations:",
    ];

    for prefix in PREFIXES {
        if let Some(local_id) = event.strip_prefix(prefix) {
            return validate_local_contribution_id(local_id);
        }
    }

    if let Some(hook) = event.strip_prefix("onTransform:") {
        return is_supported_transform_hook(hook);
    }

    false
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
    let store = load_store_from_path(&store_path)?;
    recover_plugin_installations(app, &store)?;
    Ok(store)
}

fn persistent_backup_path(path: &Path) -> Result<PathBuf, String> {
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

fn load_store_from_path(store_path: &Path) -> Result<PluginStore, String> {
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
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Failed to sync file {:?}: {}", path, error))
}

fn save_store(app: &AppHandle, store: &PluginStore) -> Result<(), String> {
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

fn write_file_atomically(path: &Path, payload: &[u8]) -> Result<(), String> {
    let temporary_path = temporary_sibling_path(path, "tmp")?;
    let backup_path = persistent_backup_path(path)?;

    let write_result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&temporary_path)
            .map_err(|error| format!("Failed to create temporary state file: {}", error))?;
        file.write_all(payload)
            .map_err(|error| format!("Failed to write temporary state file: {}", error))?;
        file.flush()
            .map_err(|error| format!("Failed to flush temporary state file: {}", error))?;
        file.sync_all()
            .map_err(|error| format!("Failed to sync temporary state file: {}", error))?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    let had_previous = path.exists();
    if had_previous {
        let backup_result = fs::copy(path, &backup_path)
            .map(|_| ())
            .map_err(|error| format!("Failed to copy existing plugin state: {}", error))
            .and_then(|_| sync_file(&backup_path));
        if let Err(error) = backup_result {
            let _ = fs::remove_file(&temporary_path);
            return Err(format!(
                "Failed to back up existing plugin state: {}",
                error
            ));
        }
    }

    if let Err(first_error) = fs::rename(&temporary_path, path) {
        if !had_previous {
            let _ = fs::remove_file(&temporary_path);
            return Err(format!(
                "Failed to replace plugin state file: {}",
                first_error
            ));
        }

        if let Err(remove_error) = fs::remove_file(path) {
            let _ = fs::remove_file(&temporary_path);
            return Err(format!(
                "Failed to replace plugin state file: {}; existing state remains: {}",
                first_error, remove_error
            ));
        }

        if let Err(second_error) = fs::rename(&temporary_path, path) {
            let restore_result = fs::copy(&backup_path, path);
            let _ = fs::remove_file(&temporary_path);
            return match restore_result {
                Ok(_) => Err(format!("Failed to replace plugin state file: {}", second_error)),
                Err(restore_error) => Err(format!(
                    "Failed to replace plugin state file: {}; backup remains at {:?}, but immediate recovery failed: {}",
                    second_error, backup_path, restore_error
                )),
            };
        }
    }

    Ok(())
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn append_bounded(
    output: &mut Vec<u8>,
    chunk: &[u8],
    maximum: usize,
    label: &str,
) -> Result<(), String> {
    if chunk.len() > maximum.saturating_sub(output.len()) {
        return Err(format!("{} exceeds {} bytes", label, maximum));
    }

    output.extend_from_slice(chunk);
    Ok(())
}

fn read_to_end_bounded<R: Read>(
    reader: &mut R,
    maximum: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut limited = reader.take(maximum as u64 + 1);
    limited
        .read_to_end(&mut output)
        .map_err(|error| format!("Failed to read {}: {}", label, error))?;

    if output.len() > maximum {
        return Err(format!("{} exceeds {} bytes", label, maximum));
    }

    Ok(output)
}

async fn read_response_body_bounded(
    mut response: reqwest::Response,
    maximum: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err(format!("{} exceeds {} bytes", label, maximum));
    }

    let mut output = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Failed to read {}: {}", label, error))?
    {
        append_bounded(&mut output, &chunk, maximum, label)?;
    }

    Ok(output)
}

fn registry_http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .timeout(HTTP_TOTAL_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to build registry HTTP client: {}", error))
}

fn package_http_client() -> Result<Client, String> {
    let redirect_policy = Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            attempt.error("too many package redirects")
        } else if attempt.url().scheme() != "https" {
            attempt.error("plugin package redirects must use HTTPS")
        } else {
            attempt.follow()
        }
    });

    Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .timeout(HTTP_TOTAL_TIMEOUT)
        .redirect(redirect_policy)
        .build()
        .map_err(|error| format!("Failed to build package HTTP client: {}", error))
}

fn is_official_registry_url(registry_url: &str) -> bool {
    registry_url == OFFICIAL_REGISTRY_URL
}

fn is_official_package_url(url: &reqwest::Url, entry: &PluginRegistryEntry) -> bool {
    let expected_path = format!(
        "/packages/{}/{}/{}-{}.grainery-plugin.zip",
        entry.id, entry.version, entry.id, entry.version
    );

    url.scheme() == "https"
        && url.host_str() == Some(OFFICIAL_PACKAGE_HOST)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == expected_path
}

fn normalize_archive_path(name: &str) -> Result<String, String> {
    if name.is_empty()
        || name.contains('\\')
        || name.starts_with('/')
        || (name.as_bytes().get(1) == Some(&b':')
            && name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic))
    {
        return Err(format!("Archive entry contains invalid path: {}", name));
    }

    let mut parts = Vec::new();
    for component in Path::new(name).components() {
        match component {
            Component::Normal(part) => parts.push(
                part.to_str()
                    .ok_or_else(|| format!("Archive entry path is not valid UTF-8: {}", name))?,
            ),
            _ => return Err(format!("Archive entry contains invalid path: {}", name)),
        }
    }

    if parts.is_empty() {
        return Err(format!("Archive entry contains invalid path: {}", name));
    }

    Ok(parts.join("/"))
}

fn validate_archive_entries<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<HashSet<String>, String> {
    if archive.len() > MAX_PLUGIN_ARCHIVE_ENTRIES {
        return Err(format!(
            "Plugin archive contains more than {} entries",
            MAX_PLUGIN_ARCHIVE_ENTRIES
        ));
    }

    let mut normalized_paths = HashSet::new();
    let mut lowercase_paths = HashSet::new();
    let mut file_paths = HashSet::new();
    let mut total_uncompressed = 0_u64;
    let mut manifest_count = 0;

    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| format!("Failed to inspect archive entry {}: {}", index, error))?;
        let name = file.name().to_string();
        let normalized = normalize_archive_path(&name)?;

        if !normalized_paths.insert(normalized.clone()) {
            return Err(format!(
                "Plugin archive contains duplicate path: {}",
                normalized
            ));
        }
        if !lowercase_paths.insert(normalized.to_lowercase()) {
            return Err(format!(
                "Plugin archive contains case-colliding path: {}",
                normalized
            ));
        }
        if file.encrypted() {
            return Err(format!("Plugin archive entry is encrypted: {}", name));
        }
        if file.is_symlink() {
            return Err(format!("Plugin archive entry is a symbolic link: {}", name));
        }
        if !matches!(
            file.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err(format!(
                "Plugin archive entry uses unsupported compression: {}",
                name
            ));
        }
        if file.size() > MAX_PLUGIN_FILE_BYTES {
            return Err(format!(
                "Plugin archive entry exceeds {} bytes: {}",
                MAX_PLUGIN_FILE_BYTES, name
            ));
        }

        total_uncompressed = total_uncompressed
            .checked_add(file.size())
            .ok_or_else(|| "Plugin archive uncompressed size overflowed".to_string())?;
        if total_uncompressed > MAX_PLUGIN_UNCOMPRESSED_BYTES {
            return Err(format!(
                "Plugin archive exceeds {} uncompressed bytes",
                MAX_PLUGIN_UNCOMPRESSED_BYTES
            ));
        }

        if normalized == MANIFEST_FILE_NAME {
            manifest_count += 1;
            if file.is_dir() {
                return Err(format!("{} must be a file", MANIFEST_FILE_NAME));
            }
            if file.size() > MAX_PLUGIN_MANIFEST_BYTES {
                return Err(format!(
                    "Plugin manifest exceeds {} bytes",
                    MAX_PLUGIN_MANIFEST_BYTES
                ));
            }
        }

        if file.is_file() {
            file_paths.insert(normalized);
        }
    }

    if manifest_count != 1 {
        return Err(format!(
            "Plugin archive must contain exactly one root {}",
            MANIFEST_FILE_NAME
        ));
    }

    Ok(file_paths)
}

fn read_manifest_from_zip<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<(PluginManifest, Value), String> {
    let mut manifest_file = archive
        .by_name(MANIFEST_FILE_NAME)
        .map_err(|_| format!("Plugin archive missing {}", MANIFEST_FILE_NAME))?;
    let manifest_bytes = read_to_end_bounded(
        &mut manifest_file,
        MAX_PLUGIN_MANIFEST_BYTES as usize,
        "plugin manifest",
    )?;
    let manifest_value = serde_json::from_slice::<Value>(&manifest_bytes)
        .map_err(|error| format!("Failed to parse plugin manifest JSON: {}", error))?;
    let manifest = serde_json::from_value::<PluginManifest>(manifest_value.clone())
        .map_err(|error| format!("Failed to parse plugin manifest: {}", error))?;

    Ok((manifest, manifest_value))
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err("Unsupported manifest schemaVersion. Expected 1".to_string());
    }

    if !validate_plugin_id(&manifest.id) {
        return Err(
            "Invalid plugin id. Expected 1-64 lowercase [a-z0-9._-] characters, excluding '.' and '..'"
                .to_string(),
        );
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
            manifest.engine.grainery, current_version
        ));
    }

    let plugin_api_version = Version::parse(PLUGIN_API_VERSION)
        .map_err(|error| format!("Failed to parse plugin API version: {}", error))?;
    let plugin_api_req = VersionReq::parse(&manifest.engine.plugin_api)
        .map_err(|error| format!("Invalid engine.pluginApi version requirement: {}", error))?;
    let required_plugin_api_req = VersionReq::parse(REQUIRED_PLUGIN_API_RANGE)
        .map_err(|error| format!("Failed to parse required plugin API range: {}", error))?;

    if !plugin_api_req.matches(&plugin_api_version) {
        return Err(format!(
            "Plugin API mismatch. Requires {}, current API version is {}",
            manifest.engine.plugin_api, plugin_api_version
        ));
    }

    if !required_plugin_api_req.matches(&plugin_api_version) {
        return Err(format!(
            "Host plugin API range misconfigured. Expected {}, current API is {}",
            REQUIRED_PLUGIN_API_RANGE, plugin_api_version
        ));
    }

    if manifest.engine.plugin_api != REQUIRED_PLUGIN_API_RANGE {
        return Err(format!(
            "Plugin engine.pluginApi must be exactly {} (found {})",
            REQUIRED_PLUGIN_API_RANGE, manifest.engine.plugin_api
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

    for permission in manifest.permission_rationales.keys() {
        if !manifest
            .optional_permissions
            .iter()
            .any(|item| item == permission)
        {
            return Err(format!(
                "permissionRationales contains '{}' but the permission is not declared optional",
                permission
            ));
        }
    }

    if manifest.activation_events.is_empty() {
        return Err("activationEvents must include at least one event".to_string());
    }

    for event in &manifest.activation_events {
        if !is_valid_activation_event(event) {
            return Err(format!("Invalid activation event '{}'", event));
        }
    }

    if (!manifest.contributes.editor_completion_providers.is_empty()
        || !manifest.contributes.editor_landmark_providers.is_empty())
        && !manifest
            .activation_events
            .iter()
            .any(|event| event == "onStartup")
    {
        return Err(
            "Editor completion and landmark providers require activationEvents to include onStartup"
                .to_string(),
        );
    }

    for command in &manifest.contributes.commands {
        if !validate_local_contribution_id(&command.id) {
            return Err(format!("Invalid command contribution id '{}'", command.id));
        }
        if command.title.trim().is_empty() {
            return Err(format!(
                "Command contribution '{}' title is required",
                command.id
            ));
        }
    }

    for menu in &manifest.contributes.menus {
        if !validate_local_contribution_id(&menu.id) {
            return Err(format!(
                "Invalid command menu contribution id '{}'",
                menu.id
            ));
        }
        if !validate_local_contribution_id(&menu.command) {
            return Err(format!(
                "Invalid command reference '{}' for menu '{}'",
                menu.command, menu.id
            ));
        }
        if !manifest
            .contributes
            .commands
            .iter()
            .any(|item| item.id == menu.command)
        {
            return Err(format!(
                "Command menu '{}' references missing command '{}'",
                menu.id, menu.command
            ));
        }
        if !is_supported_menu_location(&menu.location) {
            return Err(format!(
                "Invalid command menu location '{}' for menu '{}'",
                menu.location, menu.id
            ));
        }
        if let Some(icon) = &menu.icon {
            if !is_supported_builtin_icon(icon) {
                return Err(format!("Invalid icon '{}' for menu '{}'", icon, menu.id));
            }
        }
    }

    for keybinding in &manifest.contributes.keybindings {
        if !validate_local_contribution_id(&keybinding.id) {
            return Err(format!(
                "Invalid keybinding contribution id '{}'",
                keybinding.id
            ));
        }
        if keybinding.key.trim().is_empty() {
            return Err(format!("Keybinding '{}' key is required", keybinding.id));
        }
        if !validate_local_contribution_id(&keybinding.command) {
            return Err(format!(
                "Invalid command reference '{}' for keybinding '{}'",
                keybinding.command, keybinding.id
            ));
        }
        if !manifest
            .contributes
            .commands
            .iter()
            .any(|item| item.id == keybinding.command)
        {
            return Err(format!(
                "Keybinding '{}' references missing command '{}'",
                keybinding.id, keybinding.command
            ));
        }
    }

    if let Some(configuration) = &manifest.contributes.configuration {
        for property in &configuration.properties {
            if !validate_local_contribution_id(&property.id) {
                return Err(format!(
                    "Invalid configuration property id '{}'",
                    property.id
                ));
            }
            if property.title.trim().is_empty() {
                return Err(format!(
                    "Configuration property '{}' title is required",
                    property.id
                ));
            }
            if !is_supported_configuration_type(&property.property_type) {
                return Err(format!(
                    "Invalid configuration property type '{}' for '{}'",
                    property.property_type, property.id
                ));
            }
            if property.property_type == "enum"
                && property
                    .enum_values
                    .as_ref()
                    .map(|items| items.is_empty())
                    .unwrap_or(true)
            {
                return Err(format!(
                    "Enum configuration property '{}' must include enum values",
                    property.id
                ));
            }
        }
    }

    for exporter in &manifest.contributes.exporters {
        if !validate_local_contribution_id(&exporter.id) {
            return Err(format!(
                "Invalid exporter contribution id '{}'",
                exporter.id
            ));
        }
    }

    for importer in &manifest.contributes.importers {
        if !validate_local_contribution_id(&importer.id) {
            return Err(format!(
                "Invalid importer contribution id '{}'",
                importer.id
            ));
        }
    }

    for badge in &manifest.contributes.status_badges {
        if !validate_local_contribution_id(&badge.id) {
            return Err(format!(
                "Invalid status badge contribution id '{}'",
                badge.id
            ));
        }
    }

    for provider in &manifest.contributes.inline_annotation_providers {
        if !validate_local_contribution_id(&provider.id) {
            return Err(format!(
                "Invalid inline annotation provider contribution id '{}'",
                provider.id
            ));
        }
    }

    for provider in &manifest.contributes.editor_completion_providers {
        if !validate_local_contribution_id(&provider.id) {
            return Err(format!(
                "Invalid editor completion provider contribution id '{}'",
                provider.id
            ));
        }
    }

    for provider in &manifest.contributes.editor_landmark_providers {
        if !validate_local_contribution_id(&provider.id) {
            return Err(format!(
                "Invalid editor landmark provider contribution id '{}'",
                provider.id
            ));
        }
    }

    for control in &manifest.contributes.ui_controls {
        if !validate_local_contribution_id(&control.id) {
            return Err(format!(
                "Invalid UI control contribution id '{}'",
                control.id
            ));
        }
        if !is_supported_ui_mount(&control.mount) {
            return Err(format!(
                "Invalid UI control mount '{}' for '{}'",
                control.mount, control.id
            ));
        }
        if !is_supported_ui_kind(&control.kind) {
            return Err(format!(
                "Invalid UI control kind '{}' for '{}'",
                control.kind, control.id
            ));
        }
        if !is_supported_builtin_icon(&control.icon) {
            return Err(format!(
                "Invalid UI control icon '{}' for '{}'",
                control.icon, control.id
            ));
        }
    }

    for panel in &manifest.contributes.ui_panels {
        if !validate_local_contribution_id(&panel.id) {
            return Err(format!("Invalid UI panel contribution id '{}'", panel.id));
        }
        if let Some(icon) = &panel.icon {
            if !is_supported_builtin_icon(icon) {
                return Err(format!(
                    "Invalid UI panel icon '{}' for '{}'",
                    icon, panel.id
                ));
            }
        }
    }

    for transform in &manifest.contributes.transforms {
        if !validate_local_contribution_id(&transform.id) {
            return Err(format!(
                "Invalid transform contribution id '{}'",
                transform.id
            ));
        }

        if !is_supported_transform_hook(&transform.hook) {
            return Err(format!(
                "Invalid transform hook '{}' for transform '{}'",
                transform.hook, transform.id
            ));
        }
    }

    for event in &manifest.activation_events {
        if event == "onStartup" {
            continue;
        }

        if let Some(local_id) = event.strip_prefix("onCommand:") {
            if !manifest
                .contributes
                .commands
                .iter()
                .any(|item| item.id == local_id)
            {
                return Err(format!(
                    "Activation event '{}' references missing command contribution",
                    event
                ));
            }
            continue;
        }

        if let Some(local_id) = event.strip_prefix("onExporter:") {
            if !manifest
                .contributes
                .exporters
                .iter()
                .any(|item| item.id == local_id)
            {
                return Err(format!(
                    "Activation event '{}' references missing exporter contribution",
                    event
                ));
            }
            continue;
        }

        if let Some(local_id) = event.strip_prefix("onImporter:") {
            if !manifest
                .contributes
                .importers
                .iter()
                .any(|item| item.id == local_id)
            {
                return Err(format!(
                    "Activation event '{}' references missing importer contribution",
                    event
                ));
            }
            continue;
        }

        if let Some(local_id) = event.strip_prefix("onUIControl:") {
            if !manifest
                .contributes
                .ui_controls
                .iter()
                .any(|item| item.id == local_id)
            {
                return Err(format!(
                    "Activation event '{}' references missing UI control contribution",
                    event
                ));
            }
            continue;
        }

        if let Some(local_id) = event.strip_prefix("onUIPanel:") {
            if !manifest
                .contributes
                .ui_panels
                .iter()
                .any(|item| item.id == local_id)
            {
                return Err(format!(
                    "Activation event '{}' references missing UI panel contribution",
                    event
                ));
            }
            continue;
        }

        if let Some(local_id) = event.strip_prefix("onStatusBadge:") {
            if !manifest
                .contributes
                .status_badges
                .iter()
                .any(|item| item.id == local_id)
            {
                return Err(format!(
                    "Activation event '{}' references missing status badge contribution",
                    event
                ));
            }
            continue;
        }

        if let Some(local_id) = event.strip_prefix("onInlineAnnotations:") {
            if !manifest
                .contributes
                .inline_annotation_providers
                .iter()
                .any(|item| item.id == local_id)
            {
                return Err(format!(
                    "Activation event '{}' references missing inline annotation contribution",
                    event
                ));
            }
            continue;
        }

        if let Some(hook) = event.strip_prefix("onTransform:") {
            if !manifest
                .contributes
                .transforms
                .iter()
                .any(|item| item.hook == hook)
            {
                return Err(format!(
                    "Activation event '{}' references missing transform hook contribution",
                    event
                ));
            }
            continue;
        }
    }

    Ok(())
}

fn inspect_plugin_archive(zip_bytes: &[u8]) -> Result<(PluginManifest, Value), String> {
    if zip_bytes.len() > MAX_PLUGIN_ARCHIVE_BYTES {
        return Err(format!(
            "Plugin archive exceeds {} bytes",
            MAX_PLUGIN_ARCHIVE_BYTES
        ));
    }

    let mut archive = ZipArchive::new(Cursor::new(zip_bytes))
        .map_err(|error| format!("Failed to parse plugin archive: {}", error))?;
    let file_paths = validate_archive_entries(&mut archive)?;
    let (manifest, manifest_value) = read_manifest_from_zip(&mut archive)?;
    validate_manifest(&manifest)?;

    let entry_path = normalize_archive_path(&manifest.entry)?;
    if entry_path != manifest.entry {
        return Err("Plugin entry path must use a normalized archive path".to_string());
    }
    if !matches!(
        Path::new(&entry_path)
            .extension()
            .and_then(|value| value.to_str()),
        Some("js" | "mjs")
    ) {
        return Err("Plugin entry file must be a JavaScript module".to_string());
    }
    if !file_paths.contains(&entry_path) {
        return Err(format!(
            "Plugin entry file does not exist in archive: {}",
            manifest.entry
        ));
    }

    Ok((manifest, manifest_value))
}

fn validate_registry_entry(entry: &PluginRegistryEntry) -> Result<PluginManifest, String> {
    if entry.sha256.len() != 64
        || !entry
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err("Registry SHA256 must be 64 lowercase hexadecimal characters".to_string());
    }

    let download_url = reqwest::Url::parse(&entry.download_url)
        .map_err(|error| format!("Invalid registry download URL: {}", error))?;
    if download_url.scheme() != "https" || !download_url.path().ends_with(".grainery-plugin.zip") {
        return Err(
            "Registry download URL must be HTTPS and end in .grainery-plugin.zip".to_string(),
        );
    }

    if entry
        .manifest
        .as_object()
        .is_some_and(|manifest| manifest.contains_key("signature"))
    {
        return Err(
            "Registry v1 manifests must omit signature; trust uses the detached registry signature"
                .to_string(),
        );
    }

    let manifest = serde_json::from_value::<PluginManifest>(entry.manifest.clone())
        .map_err(|error| format!("Failed to parse registry manifest: {}", error))?;
    validate_manifest(&manifest)?;

    if entry.id != manifest.id
        || entry.name != manifest.name
        || entry.version != manifest.version
        || entry.description != manifest.description
    {
        return Err(
            "Registry entry id/name/version/description must exactly match its manifest"
                .to_string(),
        );
    }

    Ok(manifest)
}

fn validate_registry_archive_identity(
    entry: &PluginRegistryEntry,
    archive_manifest: &PluginManifest,
    archive_manifest_value: &Value,
) -> Result<(), String> {
    validate_registry_entry(entry)?;

    if entry.manifest != *archive_manifest_value {
        return Err(
            "Downloaded archive manifest does not exactly match the registry manifest".to_string(),
        );
    }

    if entry.id != archive_manifest.id
        || entry.name != archive_manifest.name
        || entry.version != archive_manifest.version
        || entry.description != archive_manifest.description
    {
        return Err(
            "Downloaded archive id/name/version/description do not match the registry entry"
                .to_string(),
        );
    }

    Ok(())
}

fn extract_zip_to_directory<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    destination: &Path,
) -> Result<(), String> {
    let mut total_written = 0_u64;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read archive entry {}: {}", index, error))?;
        let normalized = normalize_archive_path(file.name())?;
        let output_path = destination.join(normalized);

        if file.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Failed to create plugin directory: {}", error))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create plugin parent directory: {}", error))?;
        }

        let mut output_file = fs::File::create(&output_path).map_err(|error| {
            format!("Failed to create plugin file {:?}: {}", output_path, error)
        })?;
        let mut limited = (&mut file).take(MAX_PLUGIN_FILE_BYTES + 1);
        let written = std::io::copy(&mut limited, &mut output_file)
            .map_err(|error| format!("Failed to write plugin file {:?}: {}", output_path, error))?;
        if written > MAX_PLUGIN_FILE_BYTES {
            return Err(format!(
                "Plugin archive entry exceeds {} bytes during extraction: {}",
                MAX_PLUGIN_FILE_BYTES,
                file.name()
            ));
        }
        total_written = total_written
            .checked_add(written)
            .ok_or_else(|| "Plugin archive extraction size overflowed".to_string())?;
        if total_written > MAX_PLUGIN_UNCOMPRESSED_BYTES {
            return Err(format!(
                "Plugin archive exceeds {} bytes during extraction",
                MAX_PLUGIN_UNCOMPRESSED_BYTES
            ));
        }

        output_file
            .flush()
            .map_err(|error| format!("Failed to flush plugin file {:?}: {}", output_path, error))?;
    }

    Ok(())
}

fn trusted_registry_keys() -> HashMap<&'static str, &'static str> {
    HashMap::from([(
        "registry-2026-01",
        "Is9p3u0Y+ddx7ArFAFVrML8h5/DZCb2dRg5Ctl+uRWc=",
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

fn normalize_grants(
    manifest: &PluginManifest,
    grants: Vec<PluginPermissionGrant>,
) -> Vec<PluginPermissionGrant> {
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

fn recover_plugin_directory(
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

fn recover_plugin_installations(app: &AppHandle, store: &PluginStore) -> Result<(), String> {
    let install_base = plugin_install_base_dir(app)?;

    for plugin in &store.installed_plugins {
        if !validate_plugin_id(&plugin.id) {
            return Err(format!("Installed plugin has invalid id: {}", plugin.id));
        }

        let live = install_base.join(sanitize_plugin_id(&plugin.id));
        let backup = persistent_backup_path(&live)?;
        recover_plugin_directory(&live, &backup, Path::new(&plugin.entry_path))?;
    }

    Ok(())
}

fn swap_plugin_directory(staged: &Path, live: &Path, backup: &Path) -> Result<bool, String> {
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

fn install_plugin_from_zip_bytes(
    app: &AppHandle,
    zip_bytes: Vec<u8>,
    registry_entry: Option<&PluginRegistryEntry>,
    install_source: &str,
    trust: &str,
    signature_verified: bool,
    signature_key_id: Option<String>,
    registry_url: Option<String>,
    download_url: Option<String>,
) -> Result<InstalledPlugin, String> {
    let (manifest, manifest_value) = inspect_plugin_archive(&zip_bytes)?;
    if let Some(entry) = registry_entry {
        validate_registry_archive_identity(entry, &manifest, &manifest_value)?;
    }

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

async fn fetch_registry_entries(registry_url: &str) -> Result<Vec<PluginRegistryEntry>, String> {
    let client = registry_http_client()?;
    let response = client
        .get(registry_url)
        .send()
        .await
        .map_err(|error| format!("Failed to fetch registry index: {}", error))?;

    if is_official_registry_url(registry_url) && response.url().as_str() != OFFICIAL_REGISTRY_URL {
        return Err(format!(
            "Official registry redirected to unexpected URL: {}",
            response.url()
        ));
    }

    if !response.status().is_success() {
        return Err(format!(
            "Registry request failed with HTTP status {}",
            response.status()
        ));
    }

    let raw_json = read_response_body_bounded(
        response,
        MAX_REGISTRY_RESPONSE_BYTES,
        "registry response body",
    )
    .await?;

    let value: Value = serde_json::from_slice(&raw_json)
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
    let matches = entries
        .iter()
        .filter(|entry| entry.id == plugin_id)
        .cloned()
        .collect::<Vec<_>>();

    if matches.is_empty() {
        return Err(format!(
            "Plugin '{}' not found in registry index",
            plugin_id
        ));
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

    matches
        .into_iter()
        .filter(|entry| validate_registry_entry(entry).is_ok())
        .max_by(|left, right| {
            Version::parse(&left.version)
                .expect("validated registry version")
                .cmp(&Version::parse(&right.version).expect("validated registry version"))
        })
        .ok_or_else(|| format!("No compatible version found for plugin '{}'", plugin_id))
}

fn enforce_network_allowlist(plugin: &InstalledPlugin, url: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|error| format!("Invalid URL '{}': {}", url, error))?;

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

fn append_audit_log(
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

fn is_supported_diagnostic_kind(kind: &str) -> bool {
    matches!(
        kind,
        "activation-error" | "runtime-crash" | "permission-denial" | "invocation-timeout"
    )
}

fn diagnostic_id(plugin_id: &str, kind: &str, operation: Option<&str>) -> String {
    format!(
        "{}:{}:{}:{}",
        plugin_id,
        kind,
        operation.unwrap_or("general"),
        Utc::now().timestamp_millis()
    )
}

fn trim_diagnostics(diagnostics: &mut Vec<PluginDiagnostic>) {
    const MAX_DIAGNOSTICS_PER_PLUGIN: usize = 25;
    if diagnostics.len() <= MAX_DIAGNOSTICS_PER_PLUGIN {
        return;
    }

    let extra = diagnostics.len() - MAX_DIAGNOSTICS_PER_PLUGIN;
    diagnostics.drain(0..extra);
}

#[tauri::command]
pub fn plugin_list_installed(app: AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let _store_guard = lock_plugin_store()?;
    let mut store = load_store(&app)?;

    for plugin in &mut store.installed_plugins {
        hydrate_entry_source(plugin);
    }

    Ok(store.installed_plugins)
}

#[tauri::command]
pub fn plugin_get_lock_records(app: AppHandle) -> Result<Vec<PluginLockRecord>, String> {
    let _store_guard = lock_plugin_store()?;
    let store = load_store(&app)?;
    Ok(store.lock_records)
}

#[tauri::command]
pub fn plugin_install_from_file(app: AppHandle, path: String) -> Result<InstalledPlugin, String> {
    let mut file = fs::File::open(&path)
        .map_err(|error| format!("Failed to open plugin archive '{}': {}", path, error))?;
    let zip_bytes = read_to_end_bounded(&mut file, MAX_PLUGIN_ARCHIVE_BYTES, "plugin archive")?;

    install_plugin_from_zip_bytes(
        &app,
        zip_bytes,
        None,
        "sideload",
        "unverified",
        false,
        None,
        None,
        None,
    )
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
    let computed_sha256 = compute_sha256_hex(&zip_bytes);

    if computed_sha256 != selected.sha256 {
        return Err(format!(
            "SHA256 mismatch for downloaded plugin archive. Expected {}, got {}",
            selected.sha256, computed_sha256
        ));
    }

    install_plugin_from_zip_bytes(
        &app,
        zip_bytes,
        Some(&selected),
        "registry",
        "verified",
        true,
        Some(selected.signature_key_id.clone()),
        Some(registry_url),
        Some(selected.download_url.clone()),
    )
}

#[tauri::command]
pub fn plugin_uninstall(app: AppHandle, plugin_id: String) -> Result<(), String> {
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
}

#[tauri::command]
pub fn plugin_update_permissions(
    app: AppHandle,
    plugin_id: String,
    permissions: Vec<PluginPermissionGrant>,
) -> Result<InstalledPlugin, String> {
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
}

#[tauri::command]
pub fn plugin_record_diagnostic(
    app: AppHandle,
    plugin_id: String,
    diagnostic: PluginDiagnosticInput,
) -> Result<InstalledPlugin, String> {
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
}

#[tauri::command]
pub fn plugin_clear_diagnostics(
    app: AppHandle,
    plugin_id: String,
) -> Result<InstalledPlugin, String> {
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
}

#[tauri::command]
pub async fn plugin_host_call(
    app: AppHandle,
    plugin_id: String,
    operation: String,
    payload: Value,
) -> Result<Value, String> {
    let store = {
        let _store_guard = lock_plugin_store()?;
        load_store(&app)?
    };
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
                return Err(format!(
                    "HTTP request failed with status {}",
                    response.status()
                ));
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
                return Err(format!(
                    "HTTP request failed with status {}",
                    response.status()
                ));
            }

            let body = response
                .text()
                .await
                .map_err(|error| format!("Failed to read text response: {}", error))?;

            Ok(json!({ "text": body }))
        }

        "audit:log" => Ok(json!({ "ok": true })),

        "system:list_fonts" => {
            if !has_permission(plugin, "system:fonts") {
                return Err("Permission denied: system:fonts".to_string());
            }

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
        }

        "document:get" | "document:replace" => Err(
            "Document operations must be brokered by the frontend host, not plugin_host_call"
                .to_string(),
        ),

        _ => Err(format!("Unsupported host operation '{}'", operation)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::{SimpleFileOptions, ZipWriter};

    fn test_manifest() -> Value {
        json!({
            "schemaVersion": 1,
            "id": "test.plugin",
            "name": "Test Plugin",
            "version": "1.0.0",
            "description": "Test plugin description",
            "engine": {
                "grainery": format!("^{}", env!("CARGO_PKG_VERSION")),
                "pluginApi": REQUIRED_PLUGIN_API_RANGE,
            },
            "entry": "dist/main.js",
            "permissions": [],
            "activationEvents": ["onStartup"],
            "contributes": {},
        })
    }

    fn build_test_archive(
        manifest: &Value,
        add_entries: impl FnOnce(&mut ZipWriter<Cursor<Vec<u8>>>, SimpleFileOptions),
    ) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        writer.start_file(MANIFEST_FILE_NAME, options).unwrap();
        writer
            .write_all(serde_json::to_string(manifest).unwrap().as_bytes())
            .unwrap();
        writer.start_file("dist/main.js", options).unwrap();
        writer.write_all(b"export default {};").unwrap();
        add_entries(&mut writer, options);

        writer.finish().unwrap().into_inner()
    }

    fn test_registry_entry(manifest: Value) -> PluginRegistryEntry {
        PluginRegistryEntry {
            id: manifest["id"].as_str().unwrap().to_string(),
            name: manifest["name"].as_str().unwrap().to_string(),
            version: manifest["version"].as_str().unwrap().to_string(),
            description: manifest["description"].as_str().unwrap().to_string(),
            manifest,
            download_url:
                "https://plugins.grainery.xyz/packages/test.plugin/1.0.0/test.plugin-1.0.0.grainery-plugin.zip"
                    .to_string(),
            sha256: "0".repeat(64),
            signature_key_id: "test-key".to_string(),
            signature: "test-signature".to_string(),
        }
    }

    #[test]
    fn registry_identity_is_bound_to_the_downloaded_manifest() {
        let manifest_value = test_manifest();
        let archive = build_test_archive(&manifest_value, |_, _| {});
        let (archive_manifest, archive_manifest_value) = inspect_plugin_archive(&archive).unwrap();
        let entry = test_registry_entry(manifest_value.clone());

        validate_registry_archive_identity(&entry, &archive_manifest, &archive_manifest_value)
            .unwrap();

        let mut mismatched_metadata = entry.clone();
        mismatched_metadata.name = "Different Name".to_string();
        assert!(validate_registry_archive_identity(
            &mismatched_metadata,
            &archive_manifest,
            &archive_manifest_value
        )
        .unwrap_err()
        .contains("id/name/version/description"));

        let mut other_manifest = manifest_value;
        other_manifest["id"] = Value::String("other.plugin".to_string());
        let other_entry = test_registry_entry(other_manifest);
        assert!(validate_registry_archive_identity(
            &other_entry,
            &archive_manifest,
            &archive_manifest_value
        )
        .unwrap_err()
        .contains("does not exactly match"));
    }

    #[test]
    fn plugin_ids_are_canonical_lowercase_names() {
        assert!(validate_plugin_id("com.example.plugin"));
        for invalid in [".", "..", "Com.Example.Plugin", "com/example/plugin", ""] {
            assert!(!validate_plugin_id(invalid), "{}", invalid);
        }
    }

    #[test]
    fn versionless_selection_uses_the_newest_compatible_version() {
        let mut old_manifest = test_manifest();
        old_manifest["version"] = Value::String("1.0.0".to_string());
        let old = test_registry_entry(old_manifest);

        let mut compatible_manifest = test_manifest();
        compatible_manifest["version"] = Value::String("1.5.0".to_string());
        let compatible = test_registry_entry(compatible_manifest);

        let mut incompatible_manifest = test_manifest();
        incompatible_manifest["version"] = Value::String("2.0.0".to_string());
        incompatible_manifest["engine"]["grainery"] = Value::String(">=999.0.0".to_string());
        let incompatible = test_registry_entry(incompatible_manifest);

        let selected = select_registry_entry(
            &[old, incompatible.clone(), compatible],
            "test.plugin",
            None,
        )
        .unwrap();
        assert_eq!(selected.version, "1.5.0");

        let exact = select_registry_entry(&[incompatible], "test.plugin", Some("2.0.0")).unwrap();
        assert_eq!(exact.version, "2.0.0");
    }

    #[test]
    fn archive_limits_and_unsafe_paths_are_rejected() {
        let manifest = test_manifest();

        let unsafe_path = build_test_archive(&manifest, |writer, options| {
            writer.start_file("../escape.js", options).unwrap();
            writer.write_all(b"escape").unwrap();
        });
        assert!(inspect_plugin_archive(&unsafe_path)
            .unwrap_err()
            .contains("invalid path"));

        let case_collision = build_test_archive(&manifest, |writer, options| {
            writer.start_file("DIST/main.js", options).unwrap();
            writer.write_all(b"collision").unwrap();
        });
        assert!(inspect_plugin_archive(&case_collision)
            .unwrap_err()
            .contains("case-colliding"));

        let too_many_entries = build_test_archive(&manifest, |writer, options| {
            for index in 0..MAX_PLUGIN_ARCHIVE_ENTRIES - 1 {
                writer
                    .start_file(format!("assets/{}.txt", index), options)
                    .unwrap();
            }
        });
        assert!(inspect_plugin_archive(&too_many_entries)
            .unwrap_err()
            .contains("more than 256 entries"));

        let oversized_file = vec![0; MAX_PLUGIN_FILE_BYTES as usize + 1];
        let oversized_entry = build_test_archive(&manifest, |writer, options| {
            writer.start_file("assets/large.bin", options).unwrap();
            writer.write_all(&oversized_file).unwrap();
        });
        assert!(inspect_plugin_archive(&oversized_entry)
            .unwrap_err()
            .contains("entry exceeds"));

        assert!(
            inspect_plugin_archive(&vec![0; MAX_PLUGIN_ARCHIVE_BYTES + 1])
                .unwrap_err()
                .contains("archive exceeds")
        );
    }

    #[test]
    fn bounded_reads_reject_the_first_byte_over_the_limit() {
        let mut output = Vec::new();
        append_bounded(&mut output, b"1234", 4, "test body").unwrap();
        assert!(append_bounded(&mut output, b"5", 4, "test body").is_err());
    }

    #[test]
    fn production_registry_key_verifies_the_public_fixture() {
        verify_registry_signature(
            "registry-2026-01",
            "uHGyjXfy4neI3HYBNW7qi7+9IfLow7iSkxCtwlB1/URXmsmi4UXXj3lmWPOPBInmH1xwUVoxuEtKrYE6E9NwAQ==",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )
        .unwrap();
    }

    #[test]
    fn failed_directory_swap_restores_the_previous_installation() {
        let root = std::env::temp_dir().join(format!(
            "grainery-plugin-swap-test-{}-{}",
            std::process::id(),
            TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let live = root.join("live");
        let missing_staged = root.join("missing-staged");
        let backup = root.join("backup");
        fs::create_dir_all(&live).unwrap();
        fs::write(live.join("marker.txt"), "old install").unwrap();

        assert!(swap_plugin_directory(&missing_staged, &live, &backup).is_err());
        assert_eq!(
            fs::read_to_string(live.join("marker.txt")).unwrap(),
            "old install"
        );
        assert!(!backup.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn load_store_recovers_a_missing_or_corrupt_primary_from_backup() {
        let root = std::env::temp_dir().join(format!(
            "grainery-plugin-store-test-{}-{}",
            std::process::id(),
            TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let store_path = root.join(PLUGIN_STORE_FILE);
        let backup_path = persistent_backup_path(&store_path).unwrap();
        let payload = serde_json::to_vec(&PluginStore::default()).unwrap();
        fs::write(&backup_path, &payload).unwrap();

        let recovered_missing = load_store_from_path(&store_path).unwrap();
        assert!(recovered_missing.installed_plugins.is_empty());
        assert_eq!(fs::read(&store_path).unwrap(), payload);

        fs::write(&store_path, b"not json").unwrap();
        let recovered_corrupt = load_store_from_path(&store_path).unwrap();
        assert!(recovered_corrupt.lock_records.is_empty());
        assert_eq!(fs::read(&store_path).unwrap(), payload);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn plugin_directory_recovery_restores_the_store_version() {
        let root = std::env::temp_dir().join(format!(
            "grainery-plugin-recovery-test-{}-{}",
            std::process::id(),
            TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let live = root.join("test.plugin");
        let backup = root.join("test.plugin.backup");
        let expected_entry = live.join("1.0.0/dist/main.js");
        fs::create_dir_all(live.join("2.0.0/dist")).unwrap();
        fs::write(live.join("2.0.0/dist/main.js"), "new install").unwrap();
        fs::create_dir_all(backup.join("1.0.0/dist")).unwrap();
        fs::write(backup.join("1.0.0/dist/main.js"), "old install").unwrap();

        recover_plugin_directory(&live, &backup, &expected_entry).unwrap();
        assert_eq!(fs::read_to_string(expected_entry).unwrap(), "old install");
        assert!(!backup.exists());
        assert!(!live.join("2.0.0").exists());

        fs::remove_dir_all(root).unwrap();
    }
}
