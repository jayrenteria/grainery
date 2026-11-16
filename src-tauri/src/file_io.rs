use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn write_file_atomically(path: &Path, payload: &[u8]) -> io::Result<()> {
    write_with(path, |file| file.write_all(payload))
}

fn write_with(path: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    // Resolve existing symlinks so saving does not replace the link itself.
    let destination = match fs::symlink_metadata(path) {
        Ok(_) => fs::canonicalize(path)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => path.to_path_buf(),
        Err(error) => return Err(error),
    };
    let permissions = match fs::metadata(&destination) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.permissions().readonly() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "Destination is not a writable file",
                ));
            }
            Some(metadata.permissions())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let name = destination
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing file name"))?;
    let (temporary, mut file) = loop {
        let mut temporary_name = name.to_os_string();
        temporary_name.push(format!(
            ".{}.{}.tmp",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let temporary = parent.join(temporary_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => break (temporary, file),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    };
    let result = (|| {
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        write(&mut file)?;
        file.flush()?;
        file.sync_all()?;
        Ok(())
    })();
    drop(file);
    // shortcut: directory-entry durability varies by filesystem; add platform-specific syncing for power-loss guarantees.
    // A failed replacement must never delete the last good destination.
    let result = result.and_then(|()| fs::rename(&temporary, &destination));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "grainery-write-test-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn first_and_repeated_writes_replace_complete_contents() {
        let root = directory();
        let path = root.join("document.gwx");
        write_file_atomically(&path, b"first").unwrap();
        write_file_atomically(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_preparation_preserves_original_and_cleans_temp() {
        let root = directory();
        let path = root.join("document.gwx");
        fs::write(&path, b"original").unwrap();
        let result = write_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("injected write/sync failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_rename_keeps_destination_and_cleans_temp() {
        let root = directory();
        let path = root.join("document.gwx");
        let result = write_with(&path, |file| {
            file.write_all(b"new")?;
            fs::create_dir(&path)?;
            fs::write(path.join("original"), b"original")
        });
        assert!(result.is_err());
        assert_eq!(fs::read(path.join("original")).unwrap(), b"original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_only_file_is_not_replaced() {
        let root = directory();
        let path = root.join("document.gwx");
        fs::write(&path, b"original").unwrap();
        let original_permissions = fs::metadata(&path).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();
        assert!(write_file_atomically(&path, b"new").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::set_permissions(&path, original_permissions).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn follows_symlinks_and_preserves_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = directory();
        let target = root.join("target");
        let link = root.join("link");
        fs::write(&target, b"old").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
        symlink(&target, &link).unwrap();
        write_with(&link, |file| {
            assert_eq!(file.metadata()?.permissions().mode() & 0o777, 0o640);
            file.write_all(b"new")
        })
        .unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        assert_eq!(fs::read(target).unwrap(), b"new");
        assert_eq!(
            fs::metadata(link).unwrap().permissions().mode() & 0o777,
            0o640
        );
        fs::remove_dir_all(root).unwrap();
    }
}
