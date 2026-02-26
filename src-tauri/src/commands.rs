use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

use crate::windows;
use crate::windows::OverlayWindowMode;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenMode {
    Webview,
    Browser,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CameraMode {
    Booth,
    Circle,
}

#[derive(Debug, Clone, Serialize)]
struct BrowserCloseNoticePayload {
    message: String,
}

#[tauri::command]
pub async fn open_application_window(
    app: AppHandle,
    url: String,
    mode: OpenMode,
) -> Result<(), String> {
    if url.trim().is_empty() {
        return Err("applicationUrl is empty".to_string());
    }

    match mode {
        OpenMode::Webview => windows::open_or_focus_application_window(&app, &url),
        OpenMode::Browser => app
            .opener()
            .open_url(url, None::<String>)
            .map_err(|error| error.to_string()),
    }
}

#[tauri::command]
pub async fn close_application_window(app: AppHandle, mode: OpenMode) -> Result<(), String> {
    match mode {
        OpenMode::Webview => windows::close_application_window(&app),
        OpenMode::Browser => app
            .emit(
                "browser-close-not-supported",
                BrowserCloseNoticePayload {
                    message: "브라우저 모드에서는 자동 닫기를 지원하지 않습니다. 사용자가 직접 닫아주세요."
                        .to_string(),
                },
            )
            .map_err(|error| error.to_string()),
    }
}

#[tauri::command]
pub async fn focus_or_create_overlay_window(app: AppHandle) -> Result<(), String> {
    windows::focus_or_create_overlay_window(&app)
}

#[tauri::command]
pub async fn set_overlay_mode_window(app: AppHandle, mode: CameraMode) -> Result<(), String> {
    let next_mode = match mode {
        CameraMode::Booth => OverlayWindowMode::Booth,
        CameraMode::Circle => OverlayWindowMode::Circle,
    };

    windows::set_overlay_window_mode(&app, next_mode)
}

#[tauri::command]
pub async fn start_overlay_drag(app: AppHandle) -> Result<(), String> {
    windows::start_overlay_window_drag(&app)
}
