use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

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
pub(super) struct PluginStore {
    #[serde(default)]
    pub(super) installed_plugins: Vec<InstalledPlugin>,
    #[serde(default)]
    pub(super) lock_records: Vec<PluginLockRecord>,
}
