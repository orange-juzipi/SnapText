#[cfg(not(test))]
use snaptext_core::Error;
#[cfg(not(test))]
use snaptext_core::config::CloseBehavior;
use snaptext_core::{Result, config::ResultPanelDock};
#[cfg(not(test))]
use std::sync::atomic::Ordering;
use tauri::AppHandle;
#[cfg(not(test))]
use tauri::Manager;
#[cfg(not(test))]
use tauri::WebviewUrl;
#[cfg(not(test))]
use tauri::webview::WebviewWindowBuilder;
#[cfg(not(test))]
use tauri::{PhysicalPosition, WindowEvent};

#[cfg(not(test))]
use crate::MAIN_WINDOW_LABEL;
#[cfg(not(target_os = "macos"))]
use crate::OVERLAY_WINDOW_LABEL;
#[cfg(not(test))]
use crate::RESULT_WINDOW_LABEL;

/// Installs the main-window close policy using the live application configuration.
#[cfg(not(test))]
pub(crate) fn setup_main_window_close_behavior(app: &AppHandle) -> Result<()> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| Error::Config("main window is not available".to_owned()))?;
    let close_window = window.clone();
    let close_app = app.clone();

    window.on_window_event(move |event| {
        let tauri::WindowEvent::CloseRequested { api, .. } = event else {
            return;
        };

        match configured_close_behavior(&close_app) {
            CloseBehavior::Hide => {
                // Keep the process and tray alive while removing the native window.
                api.prevent_close();
                if let Err(err) = close_window.hide() {
                    tracing::warn!(error = %err, "failed to hide main window on close");
                }
            }
            CloseBehavior::Exit => {
                // Explicitly exit so an independently pinned result window cannot keep the process alive.
                api.prevent_close();
                close_app.exit(0);
            }
        }
    });

    Ok(())
}

/// Reads the current close policy and falls back to hiding the window if state is unavailable.
#[cfg(not(test))]
fn configured_close_behavior(app: &AppHandle) -> CloseBehavior {
    app.try_state::<crate::AppState>()
        .and_then(|state| {
            state
                .config
                .read()
                .ok()
                .map(|config| config.ui.close_behavior)
        })
        .unwrap_or(CloseBehavior::Hide)
}

/// Creates the independent result window on first use.
#[cfg(not(test))]
pub(crate) fn setup_result_window(app: &AppHandle) -> Result<()> {
    if app.get_webview_window(RESULT_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        RESULT_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .initialization_script("window.__SNAPTEXT_WINDOW = 'result';")
    .title("SnapText Result")
    .inner_size(460.0, 560.0)
    .min_inner_size(360.0, 320.0)
    .visible(false)
    .decorations(true)
    .always_on_top(true)
    .focused(false)
    .build()
    .map_err(|err| Error::Config(err.to_string()))?;

    // Closing the native window hides it and keeps the main window's pin state accurate.
    let close_window = window.clone();
    let close_app = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = close_window.hide();
            if let Some(state) = close_app.try_state::<crate::AppState>() {
                state.result_window_pinned.store(false, Ordering::Release);
            }
            if let Err(err) = crate::events::emit_result_window_state(&close_app, false) {
                tracing::warn!(error = %err, "failed to broadcast result window close state");
            }
        }
    });

    Ok(())
}

/// Test stub for result-window setup; unit tests use Tauri's mock runtime without native windows.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn setup_result_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

/// Shows the independent result window and positions it using the selected docking mode.
#[cfg(not(test))]
pub(crate) fn show_result_window(app: &AppHandle, dock: ResultPanelDock) -> Result<()> {
    setup_result_window(app)?;
    let window = app
        .get_webview_window(RESULT_WINDOW_LABEL)
        .ok_or_else(|| Error::Config("result window is not available".to_owned()))?;

    window
        .set_always_on_top(true)
        .map_err(|err| Error::Config(err.to_string()))?;
    position_result_window(app, &window, dock);
    window
        .show()
        .map_err(|err| Error::Config(err.to_string()))?;
    window
        .set_focus()
        .map_err(|err| Error::Config(err.to_string()))?;
    Ok(())
}

/// Test stub for showing the result window.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn show_result_window(_app: &AppHandle, _dock: ResultPanelDock) -> Result<()> {
    Ok(())
}

/// Hides the independent result window without destroying its webview state.
#[cfg(not(test))]
pub(crate) fn hide_result_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(RESULT_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

/// Test stub for hiding the result window.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn hide_result_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

/// Computes a safe desktop position for cursor-following or fixed result docking.
#[cfg(not(test))]
fn position_result_window(
    app: &AppHandle,
    result_window: &tauri::WebviewWindow,
    dock: ResultPanelDock,
) {
    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let position = match dock {
        ResultPanelDock::Cursor => main_window.cursor_position().ok().map(|cursor| {
            PhysicalPosition::new(cursor.x.round() as i32 + 18, cursor.y.round() as i32 + 18)
        }),
        ResultPanelDock::Fixed => {
            let main_position = main_window.outer_position().ok();
            let main_size = main_window.outer_size().ok();
            let result_size = result_window.outer_size().ok();
            match (main_position, main_size, result_size) {
                (Some(position), Some(main_size), Some(result_size)) => {
                    Some(PhysicalPosition::new(
                        position.x + ((main_size.width as i32 - result_size.width as i32) / 2),
                        position.y + ((main_size.height as i32 - result_size.height as i32) / 2),
                    ))
                }
                _ => None,
            }
        }
    };

    let Some(position) = position else {
        return;
    };
    let size = result_window.outer_size().ok();
    let monitor = result_window
        .monitor_from_point(f64::from(position.x), f64::from(position.y))
        .ok()
        .flatten()
        .or_else(|| result_window.current_monitor().ok().flatten());
    let position = size
        .zip(monitor)
        .map(|(size, monitor)| clamp_to_work_area(position, size, monitor))
        .unwrap_or(position);

    if let Err(err) = result_window.set_position(position) {
        tracing::debug!(error = %err, "failed to position result window");
    }
}

/// Keeps the result window entirely inside the active monitor's usable work area.
#[cfg(not(test))]
fn clamp_to_work_area(
    position: PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    monitor: tauri::Monitor,
) -> PhysicalPosition<i32> {
    let work_area = monitor.work_area();
    let width = i32::try_from(size.width).unwrap_or(i32::MAX);
    let height = i32::try_from(size.height).unwrap_or(i32::MAX);
    let area_width = i32::try_from(work_area.size.width).unwrap_or(i32::MAX);
    let area_height = i32::try_from(work_area.size.height).unwrap_or(i32::MAX);
    let min_x = work_area.position.x;
    let min_y = work_area.position.y;
    let max_x = (min_x + area_width - width).max(min_x);
    let max_y = (min_y + area_height - height).max(min_y);
    PhysicalPosition::new(
        position.x.clamp(min_x, max_x),
        position.y.clamp(min_y, max_y),
    )
}

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
        #[cfg(target_os = "macos")]
        app.show().map_err(|err| Error::Config(err.to_string()))?;

        // A long-hidden window can also be minimized or belong to a hidden macOS
        // app; normalize that state before asking the compositor for focus.
        window
            .unminimize()
            .map_err(|err| Error::Config(err.to_string()))?;
        window
            .show()
            .map_err(|err| Error::Config(err.to_string()))?;
        #[cfg(target_os = "windows")]
        {
            // Windows 对后台进程抢前台有额外限制；先置顶再聚焦能让热键结果稳定浮到最前。
            pulse_main_window_to_front(app, &window)?;
        }
        window
            .set_focus()
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn show_main_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

#[cfg(all(not(test), target_os = "windows"))]
fn pulse_main_window_to_front(app: &AppHandle, window: &tauri::WebviewWindow) -> Result<()> {
    window
        .set_always_on_top(true)
        .map_err(|err| Error::Config(err.to_string()))?;

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(900)).await;
        let Some(state) = app.try_state::<crate::AppState>() else {
            return;
        };
        if state.inner().result_window_pinned.load(Ordering::Acquire) {
            return;
        }
        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        if let Err(err) = window.set_always_on_top(false) {
            tracing::warn!(error = %err, "failed to clear Windows foreground topmost pulse");
        }
    });

    Ok(())
}
