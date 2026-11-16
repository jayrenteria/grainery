use super::manifest::validate_manifest;
use super::types::PluginManifest;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Component, Path};
use zip::{CompressionMethod, ZipArchive};

const MAX_PLUGIN_MANIFEST_BYTES: u64 = 256 * 1024;
pub(super) const MAX_PLUGIN_ARCHIVE_ENTRIES: usize = 256;
pub(super) const MAX_PLUGIN_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_PLUGIN_UNCOMPRESSED_BYTES: u64 = 50 * 1024 * 1024;
pub(super) const MAX_PLUGIN_ARCHIVE_BYTES: usize = 10 * 1024 * 1024;
pub(super) const MANIFEST_FILE_NAME: &str = "grainery-plugin.manifest.json";
pub(super) fn read_to_end_bounded<R: Read>(
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
        let name = file
            .name()
            .map_err(|error| format!("Invalid archive entry name: {}", error))?
            .into_owned();
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

pub(super) fn inspect_plugin_archive(zip_bytes: &[u8]) -> Result<(PluginManifest, Value), String> {
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

pub(super) fn extract_zip_to_directory<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    destination: &Path,
) -> Result<(), String> {
    let mut total_written = 0_u64;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read archive entry {}: {}", index, error))?;
        let name = file
            .name()
            .map_err(|error| format!("Invalid archive entry name: {}", error))?
            .into_owned();
        let normalized = normalize_archive_path(&name)?;
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
                MAX_PLUGIN_FILE_BYTES, name
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
