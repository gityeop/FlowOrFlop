use tauri::{
    webview::PageLoadEvent, AppHandle, LogicalSize, Manager, Size, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const CAMERA_OVERLAY_LABEL: &str = "camera_overlay";
pub const APPLICATION_WINDOW_LABEL: &str = "application_window";
const OVERLAY_BOOTH_WIDTH: f64 = 520.0;
const OVERLAY_BOOTH_HEIGHT: f64 = 390.0;
const OVERLAY_CIRCLE_WIDTH: f64 = 360.0;
const OVERLAY_CIRCLE_HEIGHT: f64 = 360.0;
const APPLICATION_WINDOW_SCROLL_SCRIPT: &str = r#"
(() => {
  const baseTarget = Math.max(680, Math.round(window.innerHeight * 0.78));
  const scrollTarget = Math.round(baseTarget * 3);
  const applyScroll = () => window.scrollTo({ top: scrollTarget, left: 0, behavior: "auto" });
  applyScroll();
  setTimeout(applyScroll, 180);
  setTimeout(applyScroll, 520);
  setTimeout(applyScroll, 900);
})();
"#;

pub enum OverlayWindowMode {
    Booth,
    Circle,
}

fn apply_overlay_window_style(window: &WebviewWindow) {
    let _ = window.set_title("");
    let _ = window.set_decorations(false);
    let _ = window.set_shadow(false);
    let _ = window.set_resizable(false);
    let _ = window.set_always_on_top(true);
}

fn apply_application_window_scroll(window: &WebviewWindow) {
    let _ = window.eval(APPLICATION_WINDOW_SCROLL_SCRIPT);
}

fn overlay_window_size(mode: OverlayWindowMode) -> Size {
    match mode {
        OverlayWindowMode::Booth => {
            Size::Logical(LogicalSize::new(OVERLAY_BOOTH_WIDTH, OVERLAY_BOOTH_HEIGHT))
        }
        OverlayWindowMode::Circle => {
            Size::Logical(LogicalSize::new(OVERLAY_CIRCLE_WIDTH, OVERLAY_CIRCLE_HEIGHT))
        }
    }
}

pub fn create_overlay_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(existing) = app.get_webview_window(CAMERA_OVERLAY_LABEL) {
        apply_overlay_window_style(&existing);
        return Ok(existing);
    }

    let created = WebviewWindowBuilder::new(
        app,
        CAMERA_OVERLAY_LABEL,
        WebviewUrl::App("index.html?window=overlay".into()),
    )
    .title("")
    .inner_size(OVERLAY_BOOTH_WIDTH, OVERLAY_BOOTH_HEIGHT)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .build()?;

    apply_overlay_window_style(&created);
    Ok(created)
}

pub fn set_overlay_window_mode(app: &AppHandle, mode: OverlayWindowMode) -> Result<(), String> {
    let window = create_overlay_window(app).map_err(|error| error.to_string())?;
    apply_overlay_window_style(&window);

    window
        .set_size(overlay_window_size(mode))
        .map_err(|error| error.to_string())?;

    apply_overlay_window_style(&window);
    Ok(())
}

pub fn start_overlay_window_drag(app: &AppHandle) -> Result<(), String> {
    let window = create_overlay_window(app).map_err(|error| error.to_string())?;
    apply_overlay_window_style(&window);
    window.start_dragging().map_err(|error| error.to_string())
}

pub fn focus_or_create_overlay_window(app: &AppHandle) -> Result<(), String> {
    let window = create_overlay_window(app).map_err(|error| error.to_string())?;
    apply_overlay_window_style(&window);

    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn open_or_focus_application_window(app: &AppHandle, url: &str) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(APPLICATION_WINDOW_LABEL) {
        let focused = existing
            .show()
            .and_then(|_| existing.unminimize())
            .and_then(|_| existing.set_focus());

        if focused.is_ok() {
            apply_application_window_scroll(&existing);
            return Ok(());
        }

        let _ = existing.close();
    }

    let parsed_url =
        Url::parse(url).map_err(|error| format!("invalid application URL: {error}"))?;

    WebviewWindowBuilder::new(
        app,
        APPLICATION_WINDOW_LABEL,
        WebviewUrl::External(parsed_url),
    )
    .on_page_load(|window, payload| {
        if payload.event() == PageLoadEvent::Finished {
            apply_application_window_scroll(&window);
        }
    })
    .title("FlowOrFlop Application")
    .inner_size(900.0, 900.0)
    .center()
    .resizable(true)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub fn close_application_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(APPLICATION_WINDOW_LABEL) {
        existing.close().map_err(|error| error.to_string())?;
    }

    Ok(())
}
