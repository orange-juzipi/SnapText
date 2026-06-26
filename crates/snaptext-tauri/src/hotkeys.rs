use std::{
    collections::HashMap,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

use snaptext_core::{Error, Result, config::AppConfig, hotkey::HotkeyAction};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

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
    configured_hotkeys(config)
        .into_iter()
        .map(|(action, shortcut)| {
            // Route by the plugin's stable event id. This avoids comparing user-facing
            // accelerator text with the plugin's canonical display string.
            let shortcut = shortcut
                .parse::<Shortcut>()
                .map_err(|err| Error::Config(err.to_string()))?;
            Ok((shortcut.id(), action))
        })
        .collect()
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
                        if let Err(show_err) = show_main_window(&app) {
                            tracing::warn!(error = %show_err, "failed to show main window after selection hotkey failure");
                        }
                        emit_selection_failure(&app, &err);
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

pub(crate) fn refresh_global_hotkeys(app: &AppHandle, config: &AppConfig) -> Result<()> {
    let routes = configured_hotkey_routes(config)?;
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|err| Error::Config(err.to_string()))?;
    for (_, shortcut) in configured_hotkeys(config) {
        manager
            .register(shortcut.as_str())
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    let state = app.state::<AppState>();
    *state
        .hotkey_routes
        .write()
        .map_err(|err| Error::Config(err.to_string()))? = routes;
    Ok(())
}
