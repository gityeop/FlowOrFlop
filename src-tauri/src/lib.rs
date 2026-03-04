mod commands;
mod l2cs_sidecar;
mod windows;

use commands::{
    close_application_window, close_calibration_window, estimate_l2cs_gaze,
    focus_or_create_overlay_window, open_application_window, open_calibration_window,
    reset_l2cs_sidecar, set_overlay_mode_window, start_overlay_drag,
};
use l2cs_sidecar::L2csSidecarState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(L2csSidecarState::default())
        .setup(|app| {
            windows::create_overlay_window(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_application_window,
            close_application_window,
            focus_or_create_overlay_window,
            set_overlay_mode_window,
            start_overlay_drag,
            open_calibration_window,
            close_calibration_window,
            estimate_l2cs_gaze,
            reset_l2cs_sidecar
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
