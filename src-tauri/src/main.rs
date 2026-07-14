// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's accelerated compositing path can render packaged Tauri apps as
    // a blank/black window on some Linux graphics stacks (notably Wayland). The
    // variable must be set before GTK/WebKit is initialized. Keep development
    // builds accelerated so `tauri dev` retains its normal rendering behavior.
    #[cfg(all(target_os = "linux", not(debug_assertions)))]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    grainery_lib::run()
}
