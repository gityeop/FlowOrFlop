use tauri::{
    webview::PageLoadEvent, AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    Position, Size, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const CAMERA_OVERLAY_LABEL: &str = "camera_overlay";
pub const APPLICATION_WINDOW_LABEL: &str = "application_window";
pub const CALIBRATION_WINDOW_LABEL: &str = "calibration_window";
const OVERLAY_BOOTH_WIDTH: f64 = 520.0;
const OVERLAY_BOOTH_HEIGHT: f64 = 390.0;
const OVERLAY_CIRCLE_WIDTH: f64 = 360.0;
const OVERLAY_CIRCLE_HEIGHT: f64 = 360.0;
const OVERLAY_SCALE_MIN: f64 = 0.6;
const OVERLAY_SCALE_MAX: f64 = 1.8;
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

fn apply_calibration_window_style(window: &WebviewWindow) {
    let _ = window.set_title("");
    let _ = window.set_decorations(false);
    let _ = window.set_shadow(false);
    let _ = window.set_resizable(false);
    let _ = window.set_always_on_top(true);
}

fn resolve_monitor_bounds(
    app: &AppHandle,
    anchor_label: &str,
) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    let anchor_window = app
        .get_webview_window(anchor_label)
        .or_else(|| app.get_webview_window("main"))
        .ok_or_else(|| format!("anchor window `{anchor_label}` not found"))?;

    let current_monitor = anchor_window
        .current_monitor()
        .map_err(|error| format!("failed to read anchor monitor: {error}"))?;

    let monitor = match current_monitor {
        Some(monitor) => monitor,
        None => app
            .primary_monitor()
            .map_err(|error| format!("failed to read primary monitor: {error}"))?
            .ok_or_else(|| "no monitor available".to_string())?,
    };

    let position = *monitor.position();
    let size = *monitor.size();

    if size.width == 0 || size.height == 0 {
        return Err("invalid monitor size for calibration window".to_string());
    }

    Ok((position, size))
}

fn clamp_overlay_scale(scale: f64) -> f64 {
    scale.clamp(OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX)
}

fn overlay_window_size(mode: OverlayWindowMode, scale: f64) -> Size {
    let applied_scale = clamp_overlay_scale(scale);

    let (base_width, base_height) = match mode {
        OverlayWindowMode::Booth => (OVERLAY_BOOTH_WIDTH, OVERLAY_BOOTH_HEIGHT),
        OverlayWindowMode::Circle => (OVERLAY_CIRCLE_WIDTH, OVERLAY_CIRCLE_HEIGHT),
    };

    Size::Logical(LogicalSize::new(
        (base_width * applied_scale).round(),
        (base_height * applied_scale).round(),
    ))
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

pub fn set_overlay_window_mode(
    app: &AppHandle,
    mode: OverlayWindowMode,
    scale: f64,
) -> Result<(), String> {
    let window = create_overlay_window(app).map_err(|error| error.to_string())?;
    apply_overlay_window_style(&window);

    window
        .set_size(overlay_window_size(mode, scale))
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

pub fn open_or_focus_calibration_window(app: &AppHandle, anchor_label: &str) -> Result<(), String> {
    let (monitor_position, monitor_size) = resolve_monitor_bounds(app, anchor_label)?;

    if let Some(existing) = app.get_webview_window(CALIBRATION_WINDOW_LABEL) {
        apply_calibration_window_style(&existing);
        existing
            .set_position(Position::Physical(monitor_position))
            .map_err(|error| error.to_string())?;
        existing
            .set_size(Size::Physical(monitor_size))
            .map_err(|error| error.to_string())?;
        existing.show().map_err(|error| error.to_string())?;
        existing.unminimize().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let created = WebviewWindowBuilder::new(
        app,
        CALIBRATION_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=calibration".into()),
    )
    .title("")
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .visible(true)
    .build()
    .map_err(|error| error.to_string())?;

    apply_calibration_window_style(&created);
    created
        .set_position(Position::Physical(monitor_position))
        .map_err(|error| error.to_string())?;
    created
        .set_size(Size::Physical(monitor_size))
        .map_err(|error| error.to_string())?;
    created.show().map_err(|error| error.to_string())?;
    created.unminimize().map_err(|error| error.to_string())?;
    created.set_focus().map_err(|error| error.to_string())?;

    Ok(())
}

pub fn close_calibration_window(app: &AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(CALIBRATION_WINDOW_LABEL) {
        existing.close().map_err(|error| error.to_string())?;
    }

    Ok(())
}
