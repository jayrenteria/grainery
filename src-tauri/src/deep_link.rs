use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Url};

pub const PLUGIN_INSTALL_EVENT: &str = "plugin-install-request";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallRequest {
    pub plugin_id: String,
    pub version: String,
}

#[derive(Default)]
pub struct PendingPluginInstalls {
    requests: Mutex<Vec<PluginInstallRequest>>,
}

impl PendingPluginInstalls {
    fn push(&self, request: PluginInstallRequest) {
        self.requests.lock().unwrap().push(request);
    }

    pub fn take(&self) -> Vec<PluginInstallRequest> {
        std::mem::take(&mut *self.requests.lock().unwrap())
    }
}

pub fn parse_plugin_install_url(value: &str) -> Result<PluginInstallRequest, &'static str> {
    let prefix = "grainery://plugins/";
    if !value.starts_with(prefix) {
        return Err("not a Grainery plugin install URL");
    }

    let url = Url::parse(value).map_err(|_| "invalid URL")?;
    if url.scheme() != "grainery"
        || url.host_str() != Some("plugins")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid Grainery plugin install URL");
    }

    let plugin_id = url
        .path()
        .strip_prefix('/')
        .filter(|path| is_plugin_id(path))
        .ok_or("invalid plugin ID")?
        .to_string();

    let mut query = url.query_pairs();
    let Some((key, version)) = query.next() else {
        return Err("missing plugin version");
    };
    if key != "version" || query.next().is_some() {
        return Err("invalid plugin install query");
    }

    let version = version.into_owned();
    let parsed_version = semver::Version::parse(&version).map_err(|_| "invalid plugin version")?;
    if parsed_version.to_string() != version {
        return Err("plugin version must be exact semver");
    }

    Ok(PluginInstallRequest { plugin_id, version })
}

pub fn handle_urls(app: &AppHandle, urls: impl IntoIterator<Item = Url>) {
    for url in urls {
        let Ok(request) = parse_plugin_install_url(url.as_str()) else {
            continue;
        };

        app.state::<PendingPluginInstalls>().push(request.clone());
        let _ = app.emit(PLUGIN_INSTALL_EVENT, request);
    }
}

fn is_plugin_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value != "."
        && value != ".."
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
}

#[cfg(test)]
mod tests {
    use super::parse_plugin_install_url;

    #[test]
    fn parses_the_only_supported_plugin_install_url() {
        assert_eq!(
            parse_plugin_install_url("grainery://plugins/com.example.plugin?version=1.2.3"),
            Ok(super::PluginInstallRequest {
                plugin_id: "com.example.plugin".into(),
                version: "1.2.3".into(),
            })
        );
    }

    #[test]
    fn rejects_everything_outside_the_install_contract() {
        for value in [
            "grainery://plugins/com.example.plugin",
            "grainery://plugins/Com.Example?version=1.2.3",
            "grainery://plugins/.?version=1.2.3",
            "grainery://plugins/..?version=1.2.3",
            "grainery://plugins/com.example.plugin?version=1.2",
            "grainery://plugins/com.example.plugin?version=1.2.3&version=1.2.3",
            "grainery://plugins/com.example.plugin?version=1.2.3&registryUrl=https://bad.test",
            "grainery://plugins/com.example.plugin?version=1.2.3#fragment",
            "grainery://plugins:8080/com.example.plugin?version=1.2.3",
            "grainery://user@plugins/com.example.plugin?version=1.2.3",
            "grainery://plugin/com.example.plugin?version=1.2.3",
            "https://plugins/com.example.plugin?version=1.2.3",
            "grainery://plugins/com.example.plugin/other?version=1.2.3",
        ] {
            assert!(parse_plugin_install_url(value).is_err(), "{value}");
        }

        assert!(
            parse_plugin_install_url("grainery://plugins/com.example_plugin?version=1.2.3").is_ok()
        );
    }
}
