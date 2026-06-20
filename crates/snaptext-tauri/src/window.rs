use snaptext_core::{Error, Result};
#[cfg(all(not(test), not(target_os = "macos")))]
use tauri::WebviewUrl;
#[cfg(all(not(test), not(target_os = "macos")))]
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager};

use crate::MAIN_WINDOW_LABEL;
#[cfg(not(target_os = "macos"))]
use crate::OVERLAY_WINDOW_LABEL;

#[cfg(all(not(test), not(target_os = "macos")))]
pub(crate) fn setup_overlay_window(app: &AppHandle) -> Result<()> {
    if app.get_webview_window(OVERLAY_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        OVERLAY_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .initialization_script("window.__SNAPTEXT_WINDOW = 'overlay';")
    .title("SnapText Overlay")
    .visible(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .fullscreen(true)
    .build()
    .map_err(|err| Error::Config(err.to_string()))?;

    Ok(())
}

#[cfg(any(test, target_os = "macos"))]
#[allow(dead_code)]
pub(crate) fn setup_overlay_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn show_overlay_window(app: &AppHandle) -> Result<()> {
    setup_overlay_window(app)?;
    let window = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .ok_or_else(|| Error::Config("overlay window is not available".to_owned()))?;

    // Re-apply overlay window state before every show because a reused hidden
    // WebView window can retain platform-specific chrome or z-order state.
    window
        .set_decorations(false)
        .map_err(|err| Error::Config(err.to_string()))?;
    window
        .set_always_on_top(true)
        .map_err(|err| Error::Config(err.to_string()))?;
    window
        .set_skip_taskbar(true)
        .map_err(|err| Error::Config(err.to_string()))?;
    window
        .set_fullscreen(true)
        .map_err(|err| Error::Config(err.to_string()))?;
    window
        .show()
        .map_err(|err| Error::Config(err.to_string()))?;
    window
        .set_focus()
        .map_err(|err| Error::Config(err.to_string()))?;
    Ok(())
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub(crate) fn show_overlay_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

#[cfg(all(not(test), not(target_os = "macos")))]
pub(crate) fn hide_overlay_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

#[cfg(any(test, target_os = "macos"))]
pub(crate) fn hide_overlay_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

#[cfg(not(test))]
pub(crate) fn hide_main_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn hide_main_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

#[cfg(not(test))]
pub(crate) fn main_window_is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[cfg(test)]
pub(crate) fn main_window_is_visible(_app: &AppHandle) -> bool {
    false
}

pub(crate) fn restore_main_window_if_needed(app: &AppHandle, should_restore: bool) -> Result<()> {
    if should_restore {
        show_main_window(app)?;
    }
    Ok(())
}

#[cfg(not(test))]
pub(crate) fn show_main_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn show_main_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

pub(crate) fn set_main_window_always_on_top(app: &AppHandle, always_on_top: bool) -> Result<()> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| Error::Config("main window is not available".to_owned()))?;
    window
        .set_always_on_top(always_on_top)
        .map_err(|err| Error::Config(err.to_string()))
}
