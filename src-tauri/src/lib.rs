mod commands;
mod windows;

use commands::{
    close_application_window, focus_or_create_overlay_window, open_application_window,
    set_overlay_mode_window, start_overlay_drag,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            windows::create_overlay_window(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_application_window,
            close_application_window,
            focus_or_create_overlay_window,
            set_overlay_mode_window,
            start_overlay_drag
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
