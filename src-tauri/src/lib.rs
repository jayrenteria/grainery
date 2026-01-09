#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

use std::fs;
use std::path::Path;
use tauri::menu::{
    MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

mod pdf;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
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

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .separator()
                .item(&save_item)
                .item(&save_as_item)
                .separator()
                .item(&export_fountain_item)
                .item(&export_pdf_item)
                .separator()
                .quit()
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

            // Window menu
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&file_menu, &edit_menu, &format_menu, &window_menu])
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
            export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
