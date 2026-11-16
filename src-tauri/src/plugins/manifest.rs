use super::types::{InstalledPlugin, PluginManifest, PluginPermissionGrant};
use semver::{Version, VersionReq};
use std::path::Path;

pub(super) const REQUIRED_PLUGIN_API_RANGE: &str = "^1.2.0";
const PLUGIN_API_VERSION: &str = "1.2.0";
pub(super) fn validate_plugin_id(plugin_id: &str) -> bool {
    !plugin_id.is_empty()
        && plugin_id.len() <= 64
        && plugin_id != "."
        && plugin_id != ".."
        && plugin_id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
}

pub(super) fn is_optional_permission(permission: &str) -> bool {
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

pub(super) fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
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

pub(super) fn normalize_grants(
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

pub(super) fn has_permission(plugin: &InstalledPlugin, permission: &str) -> bool {
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
