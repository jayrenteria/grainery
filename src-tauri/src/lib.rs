#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::menu::{
    MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

mod pdf;
mod plugins;

#[derive(Default)]
struct PendingOpenFiles {
    paths: Mutex<Vec<String>>,
}

impl PendingOpenFiles {
    fn push_paths(&self, mut new_paths: Vec<String>) {
        if new_paths.is_empty() {
            return;
        }

        let mut paths = self.paths.lock().unwrap();
        paths.append(&mut new_paths);
    }

    fn take_paths(&self) -> Vec<String> {
        let mut paths = self.paths.lock().unwrap();
        std::mem::take(&mut *paths)
    }
}

#[tauri::command]
fn save_screenplay(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_pdf(
    content_json: String,
    title_page_json: Option<String>,
    output_path: String,
    document_title: String,
) -> Result<(), String> {
    pdf::generate_pdf(
        &content_json,
        title_page_json.as_deref(),
        &output_path,
        &document_title,
    )
}

#[tauri::command]
fn load_screenplay(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn consume_pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    state.take_paths()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpenFiles::default())
        .setup(|app| {
            // File menu items
            let new_item = MenuItemBuilder::with_id("new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let open_item = MenuItemBuilder::with_id("open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
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
            let export_fdx_item = MenuItemBuilder::with_id("export_fdx", "Export to Final Draft...")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .separator()
                .item(&save_item)
                .item(&save_as_item)
                .separator()
                .item(&export_fountain_item)
                .item(&export_pdf_item)
                .item(&export_fdx_item)
                .build()?;

            // Edit menu with standard items
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // Format menu items
            let title_page_item = MenuItemBuilder::with_id("title_page", "Title Page...")
                .accelerator("CmdOrCtrl+Shift+T")
                .build(app)?;

            let format_menu = SubmenuBuilder::new(app, "Format")
                .item(&title_page_item)
                .build()?;

            // Grainery (app) menu with Settings
            let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Grainery")
                .about(None)
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            // Window menu
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &format_menu, &window_menu])
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

            // set transparent title bar only when building for macOS
            #[cfg(target_os = "macos")]
            let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

            let window = win_builder.build().unwrap();

            // Collect files passed as command line arguments (Windows/Linux and fallback on macOS).
            let startup_paths = std::env::args()
                .skip(1)
                .filter(|arg| Path::new(arg).exists())
                .collect::<Vec<_>>();

            if !startup_paths.is_empty() {
                let pending = app.state::<PendingOpenFiles>();
                pending.push_paths(startup_paths.clone());
            }

            // set background color and title color only when building for macOS
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSColor, NSWindow, NSWindowTitleVisibility};
                use cocoa::base::{id, nil};
                use cocoa::foundation::NSString;

                let ns_window = window.ns_window().unwrap() as id;
                unsafe {
                    let bg_color = NSColor::colorWithRed_green_blue_alpha_(
                        nil,
                        245.0 / 255.0,
                        241.0 / 255.0,
                        232.0 / 255.0,
                        1.0
                    );
                    ns_window.setBackgroundColor_(bg_color);
                    
                    // Use light appearance to get black title text
                    let appearance_name = cocoa::foundation::NSString::alloc(nil)
                        .init_str("NSAppearanceNameAqua");
                    let appearance: id = msg_send![class!(NSAppearance), appearanceNamed: appearance_name];
                    let () = msg_send![ns_window, setAppearance: appearance];
                    
                    // Ensure title is visible
                    ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleVisible);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_screenplay,
            load_screenplay,
            file_exists,
            consume_pending_open_files,
            export_pdf,
            plugins::plugin_list_installed,
            plugins::plugin_get_lock_records,
            plugins::plugin_install_from_file,
            plugins::plugin_install_from_registry,
            plugins::plugin_uninstall,
            plugins::plugin_enable_disable,
            plugins::plugin_update_permissions,
            plugins::plugin_fetch_registry_index,
            plugins::plugin_host_call
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
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
                let pending = app_handle.state::<PendingOpenFiles>();
                pending.push_paths(paths.clone());

                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("app-open-file", paths);
                }
            }
        }
    });
}
