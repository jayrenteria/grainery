use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
#[cfg(desktop)]
use tauri_plugin_window_state::{StateFlags, DEFAULT_FILENAME};

mod deep_link;
mod file_io;
mod fonts;
mod open_files;
mod pdf;
mod plugins;
use open_files::{paths_from_arguments, PendingOpenFiles};

#[derive(Default)]
struct ExitControl {
    allow_exit: Mutex<bool>,
}

#[cfg(target_os = "macos")]
fn apply_macos_titlebar_theme(
    window: &tauri::WebviewWindow,
    red: u8,
    green: u8,
    blue: u8,
    dark: bool,
) -> Result<(), String> {
    window
        .set_background_color(Some(tauri::window::Color(red, green, blue, 255)))
        .map_err(|error| error.to_string())?;
    window
        .set_theme(Some(if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }))
        .map_err(|error| error.to_string())
}

pub(crate) async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Background task failed: {}", error))?
}

#[tauri::command]
async fn save_screenplay(path: String, content: String) -> Result<(), String> {
    run_blocking(move || {
        file_io::write_file_atomically(Path::new(&path), content.as_bytes())
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn export_pdf(
    content_json: String,
    title_page_json: Option<String>,
    output_path: String,
    document_title: String,
    document_mode: String,
) -> Result<(), String> {
    run_blocking(move || {
        pdf::generate_pdf(
            &content_json,
            title_page_json.as_deref(),
            &output_path,
            &document_title,
            &document_mode,
        )
    })
    .await
}

#[tauri::command]
async fn load_screenplay(path: String) -> Result<String, String> {
    run_blocking(move || fs::read_to_string(&path).map_err(|e| e.to_string())).await
}

#[tauri::command]
async fn file_exists(path: String) -> Result<bool, String> {
    run_blocking(move || Ok(Path::new(&path).exists())).await
}

#[tauri::command]
fn get_update_target() -> Option<&'static str> {
    #[cfg(target_os = "linux")]
    if std::env::var_os("GRAINERY_DISTRIBUTION").as_deref()
        == Some(std::ffi::OsStr::new("linux-system"))
    {
        return Some("linux-system-x86_64");
    }

    None
}

#[tauri::command]
fn consume_pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    state.take_paths()
}

#[tauri::command]
fn consume_pending_plugin_installs(
    state: tauri::State<'_, deep_link::PendingPluginInstalls>,
) -> Vec<deep_link::PluginInstallRequest> {
    state.take()
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, state: tauri::State<'_, ExitControl>) {
    if let Ok(mut allow_exit) = state.allow_exit.lock() {
        *allow_exit = true;
    }
    app.exit(0);
}

#[tauri::command]
fn set_titlebar_theme_color(
    app: tauri::AppHandle,
    red: u8,
    green: u8,
    blue: u8,
    dark: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        apply_macos_titlebar_theme(&window, red, green, blue, dark)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, red, green, blue, dark);
        Ok(())
    }
}

#[cfg(desktop)]
fn has_saved_window_state(app: &tauri::AppHandle) -> bool {
    let Ok(config_dir) = app.path().app_config_dir() else {
        return false;
    };

    let path = config_dir.join(DEFAULT_FILENAME);
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };

    serde_json::from_str::<serde_json::Value>(&contents)
        .ok()
        .and_then(|value| value.get("main").cloned())
        .is_some()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // The single-instance plugin must precede deep-link so warm links reach this process.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = paths_from_arguments(argv, Path::new(&cwd));
            if !paths.is_empty() {
                app.state::<PendingOpenFiles>().push_paths(paths);
                let _ = app.emit("app-open-file", ());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingOpenFiles::default())
        .manage(deep_link::PendingPluginInstalls::default())
        .manage(ExitControl::default())
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;

            if let Some(urls) = app.deep_link().get_current()? {
                deep_link::handle_urls(app.handle(), urls);
            }

            let deep_link_app = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                deep_link::handle_urls(&deep_link_app, event.urls());
            });

            #[cfg(desktop)]
            app.handle().plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    )
                    .build(),
            )?;

            // File menu items
            let new_item = MenuItemBuilder::with_id("new", "New Screenplay")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let new_comic_item = MenuItemBuilder::with_id("new_comic", "New Comic").build(app)?;
            let new_freewrite_item =
                MenuItemBuilder::with_id("new_freewrite", "New Free Write").build(app)?;
            let open_item = MenuItemBuilder::with_id("open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let import_fdx_item =
                MenuItemBuilder::with_id("import_fdx", "Import Final Draft...").build(app)?;
            let start_screen_item =
                MenuItemBuilder::with_id("start_screen", "Start Screen").build(app)?;
            let save_item = MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as_item = MenuItemBuilder::with_id("save_as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let export_fountain_item =
                MenuItemBuilder::with_id("export_fountain", "Export as Fountain...")
                    .accelerator("CmdOrCtrl+Shift+E")
                    .build(app)?;
            let export_pdf_item = MenuItemBuilder::with_id("export_pdf", "Export as PDF...")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?;
            let export_fdx_item =
                MenuItemBuilder::with_id("export_fdx", "Export to Final Draft...").build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&new_comic_item)
                .item(&new_freewrite_item)
                .item(&open_item)
                .item(&import_fdx_item)
                .item(&start_screen_item)
                .separator()
                .item(&save_item)
                .item(&save_as_item)
                .separator()
                .item(&export_fountain_item)
                .item(&export_pdf_item)
                .item(&export_fdx_item)
                .build()?;

            let find_item = MenuItemBuilder::with_id("find", "Find...")
                .accelerator("CmdOrCtrl+F")
                .build(app)?;
            let find_next_item = MenuItemBuilder::with_id("find_next", "Find Next")
                .accelerator("CmdOrCtrl+G")
                .build(app)?;
            let find_prev_item = MenuItemBuilder::with_id("find_prev", "Find Previous")
                .accelerator("CmdOrCtrl+Shift+G")
                .build(app)?;
            let replace_item = MenuItemBuilder::with_id("replace", "Replace...")
                .accelerator("CmdOrCtrl+H")
                .build(app)?;

            // Edit menu with standard items
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .item(&find_item)
                .item(&find_next_item)
                .item(&find_prev_item)
                .item(&replace_item)
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // Grainery (app) menu with Settings
            let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let check_updates_item =
                MenuItemBuilder::with_id("check_updates", "Check for Updates...").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Grainery")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Grainery")
                .about(None)
                .separator()
                .item(&settings_item)
                .item(&check_updates_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit_item)
                .build()?;

            // Window menu
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app_handle, event| {
                let event_id = event.id().0.as_str();
                // Emit event to frontend
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("menu-event", event_id);
                }
            });

            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Untitled")
                .inner_size(800.0, 600.0);

            #[cfg(desktop)]
            let win_builder = {
                let win_builder = win_builder.visible(false);
                if has_saved_window_state(app.handle()) {
                    win_builder
                } else {
                    win_builder.maximized(true)
                }
            };

            #[cfg(not(desktop))]
            let win_builder = win_builder.maximized(true);

            // set transparent title bar only when building for macOS
            #[cfg(target_os = "macos")]
            let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

            let window = win_builder.build().unwrap();

            #[cfg(desktop)]
            {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Collect files passed as command line arguments (Windows/Linux and fallback on macOS).
            let startup_paths = paths_from_arguments(std::env::args(), &std::env::current_dir()?);

            if !startup_paths.is_empty() {
                let pending = app.state::<PendingOpenFiles>();
                pending.push_paths(startup_paths.clone());
            }

            // set background color and title color only when building for macOS
            #[cfg(target_os = "macos")]
            {
                let _ = apply_macos_titlebar_theme(&window, 245, 241, 232, false);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_screenplay,
            load_screenplay,
            file_exists,
            get_update_target,
            consume_pending_open_files,
            consume_pending_plugin_installs,
            exit_app,
            set_titlebar_theme_color,
            export_pdf,
            plugins::plugin_list_installed,
            plugins::plugin_get_lock_records,
            plugins::plugin_install_from_file,
            plugins::plugin_install_from_registry,
            plugins::plugin_uninstall,
            plugins::plugin_enable_disable,
            plugins::plugin_update_permissions,
            plugins::plugin_record_diagnostic,
            plugins::plugin_clear_diagnostics,
            plugins::plugin_fetch_registry_index,
            plugins::plugin_host_call
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        // Windows/Linux title-bar close is handled by the frontend close-request hook.
        // Keep the app-level quit interception for macOS app quits that bypass window close.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::ExitRequested { api, .. } = _event {
            let exit_control = _app_handle.state::<ExitControl>();
            let mut should_allow_exit = false;
            if let Ok(mut allow_exit) = exit_control.allow_exit.lock() {
                if *allow_exit {
                    *allow_exit = false;
                    should_allow_exit = true;
                }
            }

            if !should_allow_exit {
                api.prevent_exit();
                if let Some(window) = _app_handle.get_webview_window("main") {
                    let _ = window.emit("app-quit-requested", ());
                }
            }
            return;
        }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths = urls
                .into_iter()
                .filter_map(|url| {
                    if url.scheme() != "file" {
                        return None;
                    }

                    url.to_file_path()
                        .ok()
                        .map(|path| path.to_string_lossy().to_string())
                })
                .collect::<Vec<_>>();

            if !paths.is_empty() {
                let pending = _app_handle.state::<PendingOpenFiles>();
                pending.push_paths(paths);
                let _ = _app_handle.emit("app-open-file", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocking_tasks_run_off_caller_and_preserve_errors() {
        let caller = std::thread::current().id();
        tauri::async_runtime::block_on(async {
            let worker = run_blocking(|| Ok(std::thread::current().id()))
                .await
                .unwrap();
            assert_ne!(worker, caller);
            assert_eq!(
                run_blocking::<()>(|| Err("disk failure".into()))
                    .await
                    .unwrap_err(),
                "disk failure"
            );
            assert!(run_blocking::<()>(|| panic!("injected task panic"))
                .await
                .unwrap_err()
                .contains("Background task failed"));
        });
    }

    #[test]
    fn async_document_commands_keep_their_response_contracts() {
        let path = std::env::temp_dir().join(format!(
            "grainery-command-{}-{}.gwx",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path_string = path.to_string_lossy().into_owned();
        tauri::async_runtime::block_on(async {
            save_screenplay(path_string.clone(), "first".into())
                .await
                .unwrap();
            save_screenplay(path_string.clone(), "second".into())
                .await
                .unwrap();
            assert_eq!(
                load_screenplay(path_string.clone()).await.unwrap(),
                "second"
            );
            assert!(file_exists(path_string).await.unwrap());
        });
        fs::remove_file(path).unwrap();
    }
}
