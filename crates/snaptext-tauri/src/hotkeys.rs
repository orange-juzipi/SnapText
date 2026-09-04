use std::{
    collections::HashMap,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

use snaptext_core::{Error, Result, config::AppConfig, hotkey::HotkeyAction};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[cfg(target_os = "windows")]
use crate::main_window_is_visible;
use crate::{
    AppState, current_selection_text_inner, emit_selection_failure, emit_selection_text,
    show_main_window, start_screenshot_overlay_from_hotkey_inner,
};

const SELECTION_HOTKEY_DEBOUNCE_MS: u64 = 800;

pub(crate) fn configured_hotkeys(config: &AppConfig) -> Vec<(HotkeyAction, String)> {
    [
        (HotkeyAction::Screenshot, config.hotkeys.screenshot.as_str()),
        (HotkeyAction::Selection, config.hotkeys.selection.as_str()),
    ]
    .into_iter()
    .filter_map(|(action, shortcut)| {
        let shortcut = shortcut.trim();
        (!shortcut.is_empty()).then(|| (action, shortcut.to_owned()))
    })
    .collect()
}

pub(crate) fn configured_hotkey_routes(config: &AppConfig) -> Result<HashMap<u32, HotkeyAction>> {
    let mut routes = HashMap::new();
    for (action, shortcut) in configured_hotkeys(config) {
        // Route by the plugin's stable event id. This avoids comparing user-facing
        // accelerator text with the plugin's canonical display string.
        let shortcut = shortcut
            .parse::<Shortcut>()
            .map_err(|err| Error::Config(err.to_string()))?;
        if routes.insert(shortcut.id(), action).is_some() {
            return Err(Error::Config(
                "screenshot and selection hotkeys must be different".to_owned(),
            ));
        }
    }
    Ok(routes)
}

pub(crate) fn hotkey_action_for_event_id(state: &AppState, id: u32) -> Option<HotkeyAction> {
    state.hotkey_routes.read().ok()?.get(&id).copied()
}

fn should_ignore_selection_hotkey(state: &AppState) -> bool {
    let now = Instant::now();
    let Ok(mut last_triggered) = state.last_selection_hotkey_at.lock() else {
        return false;
    };
    if last_triggered.is_some_and(|last| {
        now.duration_since(last) < Duration::from_millis(SELECTION_HOTKEY_DEBOUNCE_MS)
    }) {
        return true;
    }
    *last_triggered = Some(now);
    false
}

pub(crate) fn handle_global_hotkey(app: AppHandle, action: HotkeyAction) {
    tracing::info!(?action, "global hotkey action triggered");
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let result = match action {
            HotkeyAction::Screenshot => {
                start_screenshot_overlay_from_hotkey_inner(&app, state.inner())
                    .await
                    .map(|_| ())
            }
            HotkeyAction::Selection => {
                if should_ignore_selection_hotkey(state.inner()) {
                    tracing::debug!("selection hotkey ignored because it was triggered recently");
                    return;
                }
                if state
                    .inner()
                    .selection_hotkey_busy
                    .swap(true, Ordering::AcqRel)
                {
                    tracing::debug!("selection hotkey ignored because a selection flow is active");
                    return;
                }
                let result = match current_selection_text_inner(state.inner()).await {
                    Ok(payload) => {
                        show_main_window(&app).map(|_| emit_selection_text(&app, &payload))
                    }
                    Err(err) => {
                        report_selection_failure(&app, &err);
                        Err(err)
                    }
                };
                state
                    .inner()
                    .selection_hotkey_busy
                    .store(false, Ordering::Release);
                result
            }
        };

        if let Err(err) = result {
            tracing::warn!(error = %err, "global hotkey action failed");
        }
    });
}

/// Reports a selection failure without pulling a hidden Windows window over the selected app.
fn report_selection_failure(app: &AppHandle, error: &Error) {
    #[cfg(target_os = "windows")]
    {
        if main_window_is_visible(app) {
            emit_selection_failure(app, error);
        } else {
            tracing::warn!(error = %error, "selection hotkey failed while the main window was hidden");
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Err(show_err) = show_main_window(app) {
            tracing::warn!(error = %show_err, "failed to show main window after selection hotkey failure");
        }
        emit_selection_failure(app, error);
    }
}

/// Replaces the process-wide shortcuts and restores the previous set if any new
/// registration fails, so a single occupied shortcut cannot disable the rest.
pub(crate) fn refresh_global_hotkeys(
    app: &AppHandle,
    config: &AppConfig,
    previous_config: Option<&AppConfig>,
) -> Result<()> {
    let routes = configured_hotkey_routes(config)?;
    let previous_config = previous_config.cloned().or_else(|| {
        app.state::<AppState>()
            .config
            .read()
            .ok()
            .map(|config| config.clone())
    });
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|err| Error::Config(err.to_string()))?;
    if let Err(register_error) = register_configured_hotkeys(manager, config) {
        let restore_result = restore_previous_hotkeys(manager, previous_config.as_ref());
        restore_hotkey_routes(app, previous_config.as_ref(), restore_result.is_ok());
        if let Err(restore_error) = restore_result {
            return Err(Error::Config(format!(
                "failed to register shortcut: {register_error}; failed to restore previous shortcuts: {restore_error}"
            )));
        }
        return Err(Error::Config(register_error.to_string()));
    }
    if let Err(route_error) = app
        .state::<AppState>()
        .hotkey_routes
        .write()
        .map(|mut routes_guard| *routes_guard = routes)
        .map_err(|err| Error::Config(err.to_string()))
    {
        let restore_result = restore_previous_hotkeys(manager, previous_config.as_ref());
        restore_hotkey_routes(app, previous_config.as_ref(), restore_result.is_ok());
        if let Err(restore_error) = restore_result {
            return Err(Error::Config(format!(
                "failed to update shortcut routes: {route_error}; failed to restore previous shortcuts: {restore_error}"
            )));
        }
        return Err(route_error);
    }
    Ok(())
}

/// Registers every configured shortcut, preserving the first registration error for rollback.
fn register_configured_hotkeys(
    manager: &tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>,
    config: &AppConfig,
) -> Result<()> {
    for (_, shortcut) in configured_hotkeys(config) {
        manager
            .register(shortcut.as_str())
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

/// Restores the previous native shortcut registration after a failed refresh.
fn restore_previous_hotkeys(
    manager: &tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>,
    previous_config: Option<&AppConfig>,
) -> Result<()> {
    manager
        .unregister_all()
        .map_err(|err| Error::Config(err.to_string()))?;
    if let Some(previous) = previous_config {
        register_configured_hotkeys(manager, previous)?;
    }
    Ok(())
}

/// Restores the in-memory event routes when native shortcut rollback succeeds.
fn restore_hotkey_routes(
    app: &AppHandle,
    previous_config: Option<&AppConfig>,
    native_restore_succeeded: bool,
) {
    if !native_restore_succeeded {
        return;
    }
    let Some(previous) = previous_config else {
        return;
    };
    let Ok(previous_routes) = configured_hotkey_routes(previous) else {
        return;
    };
    if let Ok(mut routes_guard) = app.state::<AppState>().hotkey_routes.write() {
        *routes_guard = previous_routes;
    }
}
