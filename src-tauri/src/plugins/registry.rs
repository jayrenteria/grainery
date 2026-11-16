use super::manifest::validate_manifest;
use super::types::{PluginManifest, PluginRegistryEntry};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use reqwest::redirect::Policy;
use reqwest::Client;
use semver::Version;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::Duration;

const MAX_PLUGIN_REDIRECTS: usize = 5;
pub(super) const MAX_PLUGIN_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_REGISTRY_RESPONSE_BYTES: usize = 1024 * 1024;
const HTTP_TOTAL_TIMEOUT: Duration = Duration::from_secs(30);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const OFFICIAL_PACKAGE_HOST: &str = "plugins.grainery.xyz";
const OFFICIAL_REGISTRY_URL: &str = "https://plugins.grainery.xyz/registry/v1/index.json";
pub(super) fn compute_sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub(super) fn append_bounded(
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

pub(super) async fn read_response_body_bounded(
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

pub(super) fn package_http_client() -> Result<Client, String> {
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

pub(super) fn is_official_registry_url(registry_url: &str) -> bool {
    registry_url == OFFICIAL_REGISTRY_URL
}

pub(super) fn is_official_package_url(url: &reqwest::Url, entry: &PluginRegistryEntry) -> bool {
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

pub(super) fn validate_registry_entry(
    entry: &PluginRegistryEntry,
) -> Result<PluginManifest, String> {
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

pub(super) fn validate_registry_archive_identity(
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

fn trusted_registry_keys() -> HashMap<&'static str, &'static str> {
    HashMap::from([(
        "registry-2026-01",
        "Is9p3u0Y+ddx7ArFAFVrML8h5/DZCb2dRg5Ctl+uRWc=",
    )])
}

pub(super) fn verify_registry_signature(
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

pub(super) async fn fetch_registry_entries(
    registry_url: &str,
) -> Result<Vec<PluginRegistryEntry>, String> {
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

pub(super) fn select_registry_entry(
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

pub(super) fn validate_network_url(
    allowlist: &[String],
    parsed: &reqwest::Url,
) -> Result<(), String> {
    if parsed.scheme() != "https" {
        return Err("Only https:// URLs are allowed for plugin network calls".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Plugin network URLs must not contain credentials".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL is missing a host".to_string())?;
    if !allowlist
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(host))
    {
        return Err(format!("Host '{}' is not in plugin allowlist", host));
    }
    Ok(())
}

pub(super) fn validate_network_redirect(
    allowlist: &[String],
    url: &reqwest::Url,
    previous: &[reqwest::Url],
) -> Result<(), String> {
    validate_network_url(allowlist, url)?;
    if previous.len() > MAX_PLUGIN_REDIRECTS {
        return Err("Too many plugin redirects".to_string());
    }
    if previous.contains(url) {
        return Err("Plugin redirect loop".to_string());
    }
    Ok(())
}

pub(super) fn plugin_http_client(allowlist: Vec<String>) -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .timeout(HTTP_TOTAL_TIMEOUT)
        .redirect(Policy::custom(
            move |attempt| match validate_network_redirect(
                &allowlist,
                attempt.url(),
                attempt.previous(),
            ) {
                Ok(()) => attempt.follow(),
                Err(error) => attempt.error(error),
            },
        ))
        .build()
        .map_err(|error| format!("Failed to build plugin HTTP client: {}", error))
}

pub(super) async fn fetch_plugin_body(client: &Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
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
    read_response_body_bounded(
        response,
        MAX_PLUGIN_RESPONSE_BYTES,
        "plugin network response",
    )
    .await
}

pub(super) fn decode_plugin_body(body: &[u8], json_response: bool) -> Result<Value, String> {
    if json_response {
        serde_json::from_slice(body)
            .map_err(|error| format!("Failed to parse JSON response: {}", error))
    } else {
        Ok(json!({ "text": String::from_utf8_lossy(body) }))
    }
}
