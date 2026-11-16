use super::{archive::*, manifest::*, registry::*, store::*, types::*};
use reqwest::Client;
use serde_json::{json, Value};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::Duration;
use zip::{CompressionMethod, ZipArchive};

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

fn recovery_test_root() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "grainery-uninstall-test-{}-{}",
        std::process::id(),
        TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(root.join("installed/test.plugin")).unwrap();
    fs::write(root.join("installed/test.plugin/main.js"), b"original").unwrap();
    root
}

fn installed_fixture(root: &Path, id: &str) -> InstalledPlugin {
    InstalledPlugin {
        id: id.into(),
        name: id.into(),
        version: "1.0.0".into(),
        description: String::new(),
        enabled: true,
        trust: "unverified".into(),
        install_source: "sideload".into(),
        installed_at: now_iso(),
        updated_at: now_iso(),
        entry_path: root
            .join("installed")
            .join(id)
            .join("main.js")
            .to_string_lossy()
            .into_owned(),
        entry_source: None,
        crash_count: 0,
        diagnostics: vec![],
        network_allowlist: vec![],
        manifest: serde_json::from_value(test_manifest()).unwrap(),
        granted_permissions: vec![],
    }
}

#[test]
fn uninstall_rolls_back_failed_commit_and_accepts_missing_files() {
    let root = recovery_test_root();
    assert!(uninstall_with_commit(
        &root,
        "test.plugin",
        || Err("injected state failure".into())
    )
    .is_err());
    assert_eq!(
        fs::read(root.join("installed/test.plugin/main.js")).unwrap(),
        b"original"
    );
    uninstall_with_commit(&root, "test.plugin", || Ok(())).unwrap();
    assert!(!root.join("installed/test.plugin").exists());
    uninstall_with_commit(&root, "test.plugin", || Ok(())).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn interrupted_uninstall_obeys_committed_state_and_retries_cleanup() {
    let root = recovery_test_root();
    let mut store = PluginStore {
        installed_plugins: vec![installed_fixture(&root, "test.plugin")],
        lock_records: vec![],
    };
    let staged = root.join("pending-uninstalls/test.plugin");
    fs::create_dir_all(staged.parent().unwrap()).unwrap();
    fs::rename(root.join("installed/test.plugin"), &staged).unwrap();
    recover_pending_uninstalls(&root, &store).unwrap();
    assert!(root.join("installed/test.plugin/main.js").exists());
    fs::rename(root.join("installed/test.plugin"), &staged).unwrap();
    store.installed_plugins.clear();
    recover_pending_uninstalls(&root, &store).unwrap();
    assert!(!staged.exists());
    // A retained artifact which cannot be removed as a directory is non-fatal.
    fs::write(&staged, b"cleanup failure").unwrap();
    recover_pending_uninstalls(&root, &store).unwrap();
    assert!(staged.exists());
    fs::remove_file(&staged).unwrap();
    fs::create_dir(&staged).unwrap();
    recover_pending_uninstalls(&root, &store).unwrap();
    assert!(!staged.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_plugin_is_disabled_without_blocking_healthy_plugins() {
    let root = recovery_test_root();
    let mut store = PluginStore {
        installed_plugins: vec![
            installed_fixture(&root, "missing.plugin"),
            installed_fixture(&root, "test.plugin"),
        ],
        lock_records: vec![],
    };
    recover_installations_at(&root.join("installed"), &mut store).unwrap();
    assert!(!store.installed_plugins[0].enabled);
    assert_eq!(
        store.installed_plugins[0].diagnostics[0].kind,
        "activation-error"
    );
    assert!(store.installed_plugins[1].enabled);
    store.installed_plugins[0].id = "..".into();
    assert!(recover_installations_at(&root.join("installed"), &mut store).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn plugin_network_policy_checks_each_redirect() {
    let allowlist = vec!["allowed.test".to_string(), "other.test".to_string()];
    let origin = reqwest::Url::parse("https://allowed.test/start").unwrap();
    let relative = origin.join("/next").unwrap();
    assert!(
        validate_network_redirect(&allowlist, &relative, std::slice::from_ref(&origin)).is_ok()
    );
    assert!(validate_network_redirect(
        &allowlist,
        &reqwest::Url::parse("https://other.test/ok").unwrap(),
        std::slice::from_ref(&origin)
    )
    .is_ok());
    for bad in [
        "http://allowed.test/",
        "https://bad.test/",
        "https://allowed.test.bad.test/",
        "https://user@allowed.test/",
    ] {
        assert!(
            validate_network_url(&allowlist, &reqwest::Url::parse(bad).unwrap()).is_err(),
            "{}",
            bad
        );
    }
    assert!(validate_network_redirect(&allowlist, &origin, std::slice::from_ref(&origin)).is_err());
    assert!(validate_network_redirect(&allowlist, &relative, &vec![origin.clone(); 6]).is_err());
    assert!(validate_network_redirect(&allowlist, &relative, &vec![origin; 5]).is_ok());
    assert!(validate_network_url(&[], &relative).is_err());
    assert!(decode_plugin_body(b"not JSON", true).is_err());
    assert_eq!(
        decode_plugin_body(br#"{"ok":true}"#, true).unwrap(),
        json!({"ok":true})
    );
    assert_eq!(
        decode_plugin_body(b"text", false).unwrap(),
        json!({"text":"text"})
    );
}

fn local_response(headers: String, body: Vec<u8>, delay: Duration) -> String {
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = server.local_addr().unwrap();
    std::thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let _ = stream.read(&mut [0; 4096]);
        let _ = stream.write_all(headers.as_bytes());
        std::thread::sleep(delay);
        let _ = stream.write_all(&body);
    });
    format!("http://{}", address)
}

#[test]
fn plugin_response_limits_cover_declared_chunked_and_stalled_bodies() {
    tauri::async_runtime::block_on(async {
        let client = Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        for size in [MAX_PLUGIN_RESPONSE_BYTES, MAX_PLUGIN_RESPONSE_BYTES + 1] {
            let url = local_response(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    size
                ),
                vec![b'x'; size],
                Duration::ZERO,
            );
            let result = fetch_plugin_body(&client, &url).await;
            assert_eq!(result.is_ok(), size == MAX_PLUGIN_RESPONSE_BYTES);
        }
        let size = MAX_PLUGIN_RESPONSE_BYTES + 1;
        let mut chunked = format!("{:x}\r\n", size).into_bytes();
        chunked.extend(vec![b'x'; size]);
        chunked.extend_from_slice(b"\r\n0\r\n\r\n");
        let url = local_response(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".into(),
            chunked,
            Duration::ZERO,
        );
        assert!(fetch_plugin_body(&client, &url)
            .await
            .unwrap_err()
            .contains("exceeds"));
        let url = local_response(
            "HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n".into(),
            vec![b'x'],
            Duration::from_millis(200),
        );
        let short_client = Client::builder()
            .timeout(Duration::from_millis(30))
            .build()
            .unwrap();
        assert!(fetch_plugin_body(&short_client, &url).await.is_err());
        let url = local_response(
            "HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n".into(),
            vec![],
            Duration::ZERO,
        );
        assert!(fetch_plugin_body(&client, &url)
            .await
            .unwrap_err()
            .contains("503"));
    });
}

#[test]
fn registry_identity_is_bound_to_the_downloaded_manifest() {
    let manifest_value = test_manifest();
    let archive = build_test_archive(&manifest_value, |_, _| {});
    let (archive_manifest, archive_manifest_value) = inspect_plugin_archive(&archive).unwrap();
    let entry = test_registry_entry(manifest_value.clone());

    validate_registry_archive_identity(&entry, &archive_manifest, &archive_manifest_value).unwrap();

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
fn plugin_archives_reject_symbolic_links() {
    let archive = build_test_archive(&test_manifest(), |writer, options| {
        writer
            .add_symlink("assets/external", "../../outside", options)
            .unwrap();
    });
    assert!(inspect_plugin_archive(&archive)
        .unwrap_err()
        .contains("symbolic link"));
}

#[test]
fn valid_plugin_archives_extract_expected_files() {
    let bytes = build_test_archive(&test_manifest(), |writer, options| {
        writer.start_file("assets/café.txt", options).unwrap();
        writer.write_all(b"asset").unwrap();
    });
    inspect_plugin_archive(&bytes).unwrap();
    let root = std::env::temp_dir().join(format!(
        "grainery-plugin-extract-test-{}-{}",
        std::process::id(),
        TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    extract_zip_to_directory(&mut archive, &root).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("dist/main.js")).unwrap(),
        "export default {};"
    );
    assert_eq!(fs::read(root.join("assets/café.txt")).unwrap(), b"asset");
    fs::remove_dir_all(root).unwrap();
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
fn repeated_store_writes_keep_a_synced_backup() {
    let root = std::env::temp_dir().join(format!(
        "grainery-store-write-{}-{}",
        std::process::id(),
        TEMP_PATH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).unwrap();
    let path = root.join("state.json");
    write_file_atomically(&path, b"first").unwrap();
    write_file_atomically(&path, b"second").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"second");
    assert_eq!(
        fs::read(persistent_backup_path(&path).unwrap()).unwrap(),
        b"first"
    );
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
