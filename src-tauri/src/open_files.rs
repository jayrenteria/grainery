use std::path::Path;
use std::sync::Mutex;

#[derive(Default)]
pub(crate) struct PendingOpenFiles {
    paths: Mutex<Vec<String>>,
}

impl PendingOpenFiles {
    pub(crate) fn push_paths(&self, new_paths: Vec<String>) {
        let mut paths = self
            .paths
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        for path in new_paths {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }

    pub(crate) fn take_paths(&self) -> Vec<String> {
        std::mem::take(
            &mut *self
                .paths
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()),
        )
    }
}

pub(crate) fn paths_from_arguments(
    args: impl IntoIterator<Item = String>,
    cwd: &Path,
) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter_map(|argument| {
            if argument.starts_with('-') || argument.contains("://") {
                return None;
            }
            let path = Path::new(&argument);
            let path = if path.is_absolute() {
                path.to_path_buf()
            } else {
                cwd.join(path)
            };
            path.is_file().then(|| path.to_string_lossy().into_owned())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incoming_arguments_use_the_second_process_working_directory() {
        let root = std::env::temp_dir().join(format!(
            "grainery-open-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("A screenplay é.gwx");
        std::fs::write(&file, b"{}").unwrap();
        let arguments = vec![
            "Grainery".into(),
            "A screenplay é.gwx".into(),
            file.to_string_lossy().into_owned(),
            "--help".into(),
            "grainery://plugins/test?version=1.0.0".into(),
            "https://example.test/".into(),
            "missing.gwx".into(),
            ".".into(),
        ];
        let paths = paths_from_arguments(arguments, &root);
        assert_eq!(paths, vec![file.to_string_lossy().into_owned(); 2]);
        let queue = PendingOpenFiles::default();
        queue.push_paths(paths);
        assert_eq!(
            queue.take_paths(),
            vec![file.to_string_lossy().into_owned()]
        );
        assert!(queue.take_paths().is_empty());
        queue.push_paths(vec!["second.gwx".into()]);
        assert_eq!(queue.take_paths(), vec!["second.gwx"]);
        std::fs::remove_dir_all(root).unwrap();
    }
}
