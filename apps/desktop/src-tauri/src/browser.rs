//! Browser Panel backend: native child webviews embedded in the main window.
//!
//! Each Browser Panel owns one native child webview, added to the main window with
//! `Window::add_child` (Tauri `unstable` feature, see ADR 0004). The webview floats above
//! the React UI at logical-pixel bounds the frontend drives from a `ResizeObserver` on the
//! panel region. Tauri's webview manager is the source of truth — webviews are looked up by
//! a deterministic label derived from the panel id, so there is no parallel registry.
//!
//! Every command is `async`: `add_child` and the webview dispatchers block on the main
//! thread, and a synchronous Tauri command runs *on* the main thread, which deadlocks on
//! Windows (tauri 2.11.2 `webview/mod.rs` docs). `async` schedules the command off the main
//! thread so the main thread is free to service the dispatch.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// Label of the main app window/webview, declared in `tauri.conf.json`.
const MAIN_WINDOW_LABEL: &str = "main";
/// Prefix applied to every Browser Panel webview label, so orphan cleanup can identify
/// browser webviews without touching the main webview or any future child webview.
const LABEL_PREFIX: &str = "browser-";

#[derive(Debug, thiserror::Error)]
pub enum BrowserError {
    #[error("main window `{0}` was not found")]
    MainWindowMissing(&'static str),
    #[error("browser panel `{0}` has no open webview")]
    WebviewMissing(String),
    #[error("`{url}` is not a valid URL: {message}")]
    InvalidUrl { url: String, message: String },
    #[error("tauri operation failed: {0}")]
    Tauri(#[from] tauri::Error),
}

impl serde::Serialize for BrowserError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// Logical-pixel rectangle for a Browser Panel webview, relative to the window content
/// origin. The window runs with `decorations: false`, so the content origin is the window's
/// top-left and a DOM `getBoundingClientRect()` maps directly onto these bounds.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Events pushed to the frontend on the per-panel channel `browser://<panelId>`.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum BrowserEvent {
    Navigated { url: String },
    TitleChanged { title: String },
}

fn webview_label(panel_id: &str) -> String {
    format!("{LABEL_PREFIX}{panel_id}")
}

fn event_name(panel_id: &str) -> String {
    format!("browser://{panel_id}")
}

fn parse_url(url: &str) -> Result<tauri::Url, BrowserError> {
    url.parse::<tauri::Url>()
        .map_err(|error| BrowserError::InvalidUrl {
            url: url.to_string(),
            message: error.to_string(),
        })
}

/// Opens the Browser Panel webview over `bounds` loading `url`, or — if the webview already
/// exists (panel re-activated after a tab switch) — shows it and repositions it, preserving
/// its live page state.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; WebView2 add_child deadlocks in a sync command (tauri 2.11.2 webview docs)"
)]
#[tauri::command]
pub async fn browser_panel_open(
    app: AppHandle,
    panel_id: String,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), BrowserError> {
    let label = webview_label(&panel_id);

    if let Some(existing) = app.get_webview(&label) {
        existing.set_position(LogicalPosition::new(bounds.x, bounds.y))?;
        existing.set_size(LogicalSize::new(bounds.width, bounds.height))?;
        existing.show()?;
        return Ok(());
    }

    let window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or(BrowserError::MainWindowMissing(MAIN_WINDOW_LABEL))?;
    let parsed = parse_url(&url)?;

    let nav_app = app.clone();
    let nav_panel_id = panel_id.clone();
    let title_app = app.clone();
    let title_panel_id = panel_id.clone();
    let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .on_navigation(move |target| {
            let _ = nav_app.emit(
                &event_name(&nav_panel_id),
                BrowserEvent::Navigated {
                    url: target.as_str().to_string(),
                },
            );
            true
        })
        .on_document_title_changed(move |_webview, title| {
            let _ = title_app.emit(
                &event_name(&title_panel_id),
                BrowserEvent::TitleChanged { title },
            );
        });

    window.add_child(
        builder,
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width, bounds.height),
    )?;
    Ok(())
}

/// Repositions/resizes the Browser Panel webview — the bounds-sync primitive driven from a
/// `ResizeObserver` on the panel region. A no-op if the webview is not open.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; webview dispatch deadlocks in a sync command on Windows"
)]
#[tauri::command]
pub async fn browser_panel_set_bounds(
    app: AppHandle,
    panel_id: String,
    bounds: BrowserBounds,
) -> Result<(), BrowserError> {
    let Some(webview) = app.get_webview(&webview_label(&panel_id)) else {
        return Ok(());
    };
    webview.set_position(LogicalPosition::new(bounds.x, bounds.y))?;
    webview.set_size(LogicalSize::new(bounds.width, bounds.height))?;
    Ok(())
}

/// Hides the Browser Panel webview without destroying it, so its page state survives while
/// another panel is active. A no-op if the webview is not open.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; webview dispatch deadlocks in a sync command on Windows"
)]
#[tauri::command]
pub async fn browser_panel_hide(app: AppHandle, panel_id: String) -> Result<(), BrowserError> {
    let Some(webview) = app.get_webview(&webview_label(&panel_id)) else {
        return Ok(());
    };
    webview.hide()?;
    Ok(())
}

/// Navigates the Browser Panel webview to `url` (address-bar submit).
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; webview dispatch deadlocks in a sync command on Windows"
)]
#[tauri::command]
pub async fn browser_panel_navigate(
    app: AppHandle,
    panel_id: String,
    url: String,
) -> Result<(), BrowserError> {
    let webview = app
        .get_webview(&webview_label(&panel_id))
        .ok_or_else(|| BrowserError::WebviewMissing(panel_id.clone()))?;
    webview.navigate(parse_url(&url)?)?;
    Ok(())
}

/// Reloads the Browser Panel webview's current page.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; webview dispatch deadlocks in a sync command on Windows"
)]
#[tauri::command]
pub async fn browser_panel_reload(app: AppHandle, panel_id: String) -> Result<(), BrowserError> {
    let webview = app
        .get_webview(&webview_label(&panel_id))
        .ok_or_else(|| BrowserError::WebviewMissing(panel_id.clone()))?;
    webview.reload()?;
    Ok(())
}

/// Navigates the Browser Panel webview back one entry in its session history.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; webview dispatch deadlocks in a sync command on Windows"
)]
#[tauri::command]
pub async fn browser_panel_go_back(app: AppHandle, panel_id: String) -> Result<(), BrowserError> {
    let webview = app
        .get_webview(&webview_label(&panel_id))
        .ok_or_else(|| BrowserError::WebviewMissing(panel_id.clone()))?;
    webview.eval("history.back()")?;
    Ok(())
}

/// Navigates the Browser Panel webview forward one entry in its session history.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; webview dispatch deadlocks in a sync command on Windows"
)]
#[tauri::command]
pub async fn browser_panel_go_forward(
    app: AppHandle,
    panel_id: String,
) -> Result<(), BrowserError> {
    let webview = app
        .get_webview(&webview_label(&panel_id))
        .ok_or_else(|| BrowserError::WebviewMissing(panel_id.clone()))?;
    webview.eval("history.forward()")?;
    Ok(())
}

/// Closes and destroys the Browser Panel webview (panel deleted). A no-op if not open.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; webview dispatch deadlocks in a sync command on Windows"
)]
#[tauri::command]
pub async fn browser_panel_close(app: AppHandle, panel_id: String) -> Result<(), BrowserError> {
    let Some(webview) = app.get_webview(&webview_label(&panel_id)) else {
        return Ok(());
    };
    webview.close()?;
    Ok(())
}

/// Closes every Browser Panel webview whose panel id is not in `keep_panel_ids`. Called when
/// a workspace mounts so webviews left over from a previously open Session are reclaimed.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require AppHandle by value"
)]
#[allow(
    clippy::unused_async,
    reason = "async schedules this off the main thread; webview dispatch deadlocks in a sync command on Windows"
)]
#[tauri::command]
pub async fn browser_close_orphans(
    app: AppHandle,
    keep_panel_ids: Vec<String>,
) -> Result<(), BrowserError> {
    let keep: std::collections::HashSet<String> =
        keep_panel_ids.iter().map(|id| webview_label(id)).collect();
    for (label, webview) in app.webviews() {
        if label.starts_with(LABEL_PREFIX) && !keep.contains(&label) {
            webview.close()?;
        }
    }
    Ok(())
}
