#[cfg(not(test))]
use snaptext_core::{Error, Result};
#[cfg(not(test))]
use tauri::{AppHandle, Manager};
#[cfg(not(test))]
use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::TrayIconBuilder,
};

#[cfg(not(test))]
use crate::MAIN_WINDOW_LABEL;

pub(crate) const TRAY_SHOW: &str = "show";
pub(crate) const TRAY_HIDE: &str = "hide";
pub(crate) const TRAY_QUIT: &str = "quit";

#[cfg(not(test))]
pub(crate) fn setup_tray(app: &AppHandle) -> Result<()> {
    let show = MenuItemBuilder::with_id(TRAY_SHOW, "显示 SnapText")
        .build(app)
        .map_err(|err| Error::Config(err.to_string()))?;
    let hide = MenuItemBuilder::with_id(TRAY_HIDE, "隐藏窗口")
        .build(app)
        .map_err(|err| Error::Config(err.to_string()))?;
    let quit = MenuItemBuilder::with_id(TRAY_QUIT, "退出")
        .build(app)
        .map_err(|err| Error::Config(err.to_string()))?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])
        .map_err(|err| Error::Config(err.to_string()))?;
    let Some(icon) = app.default_window_icon().cloned() else {
        // Development builds may not have bundle icons yet; keep the app usable.
        tracing::warn!("tray icon skipped because no application icon is configured");
        return Ok(());
    };

    TrayIconBuilder::with_id("snaptext-main")
        .icon(icon)
        .tooltip("SnapText")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_tray_action(app, tray_action_for_id(event.id().as_ref()))
        })
        .build(app)
        .map_err(|err| Error::Config(err.to_string()))?;

    Ok(())
}

#[cfg(not(test))]
fn handle_tray_action(app: &AppHandle, action: Option<TrayAction>) {
    match action {
        Some(TrayAction::Show) => {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL)
                && let Err(err) = window.show().and_then(|_| window.set_focus())
            {
                tracing::warn!(error = %err, "failed to show main window from tray");
            }
        }
        Some(TrayAction::Hide) => {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL)
                && let Err(err) = window.hide()
            {
                tracing::warn!(error = %err, "failed to hide main window from tray");
            }
        }
        Some(TrayAction::Quit) => app.exit(0),
        None => {}
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TrayAction {
    Show,
    Hide,
    Quit,
}

pub(crate) fn tray_action_for_id(id: &str) -> Option<TrayAction> {
    match id {
        TRAY_SHOW => Some(TrayAction::Show),
        TRAY_HIDE => Some(TrayAction::Hide),
        TRAY_QUIT => Some(TrayAction::Quit),
        _ => None,
    }
}
