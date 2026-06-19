#[cfg(not(test))]
use std::collections::HashMap;
use std::{
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, RwLock},
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageFormat, RgbaImage};
#[cfg(not(test))]
use snaptext_core::hotkey::HotkeyAction;
#[cfg(not(test))]
use snaptext_core::selection::ensure_selection_permission;
use snaptext_core::{
    Error, Result,
    config::{AppConfig, Lang, ModelDir, SpeechProvider},
    history::{HistoryRecord, HistorySource, HistoryStore, NewHistoryRecord},
    ocr::OcrEngine,
    pipeline::{TranslationResult, first_translated_text},
    screenshot::{ImageMeta, Screencap},
    selection::{
        SelectionEvent, SelectionWatcher, normalize_selection_text, selection_permission_status,
    },
    translate::{TranslateRequest, TranslatorRegistry},
};
#[cfg(all(not(test), not(target_os = "macos")))]
use tauri::WebviewUrl;
#[cfg(all(not(test), not(target_os = "macos")))]
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(not(test))]
use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::TrayIconBuilder,
};
#[cfg(not(test))]
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

const OVERLAY_TRANSLATION_EVENT: &str = "snaptext://overlay-translation";
#[cfg(target_os = "macos")]
const OVERLAY_OCR_STARTED_EVENT: &str = "snaptext://overlay-ocr-started";
#[cfg(target_os = "macos")]
const OVERLAY_OCR_FAILED_EVENT: &str = "snaptext://overlay-ocr-failed";
const OVERLAY_OCR_EVENT: &str = "snaptext://overlay-ocr";
const RESULT_TRANSLATION_EVENT: &str = "snaptext://result-translation";
const RESULT_SELECTION_EVENT: &str = "snaptext://result-selection";
#[cfg(not(test))]
const SELECTION_TEXT_EVENT: &str = "snaptext://selection-text";
#[cfg(not(test))]
const RESULT_SELECTION_FAILED_EVENT: &str = "snaptext://result-selection-failed";
const RESULT_WINDOW_STATE_EVENT: &str = "snaptext://result-window-state";
const MAIN_WINDOW_LABEL: &str = "main";
#[cfg(not(target_os = "macos"))]
const OVERLAY_WINDOW_LABEL: &str = "overlay";
const TRAY_SHOW: &str = "show";
const TRAY_HIDE: &str = "hide";
const TRAY_QUIT: &str = "quit";
const MAX_IMAGE_PAYLOAD_BYTES: usize = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 24_000_000;
const MAIN_WINDOW_HIDE_SETTLE_MS: u64 = 160;
const OCR_WORKER_PATH: &str = "python/ocr_worker.py";
const TTS_WORKER_PATH: &str = "python/tts_worker.py";
const SNAPTEXT_PYTHON_ENV: &str = "SNAPTEXT_PYTHON";
const SNAPTEXT_TTS_PYTHON_ENV: &str = "SNAPTEXT_TTS_PYTHON";
const OCR_VENV_PYTHON: &str = ".venv-ocr/bin/python";
const TTS_VENV_PYTHON: &str = ".venv-tts/bin/python";

pub struct AppState {
    config_path: Option<PathBuf>,
    resource_dir: Option<PathBuf>,
    config: RwLock<AppConfig>,
    history: Mutex<HistoryStore>,
    ocr: RwLock<OcrEngine>,
    screencap: Screencap,
    selection: SelectionWatcher,
    pending_overlay: Mutex<Option<OverlaySession>>,
    translator: RwLock<TranslatorRegistry>,
    #[cfg(test)]
    fake_translated_text: Mutex<Option<String>>,
    #[cfg(not(test))]
    hotkey_routes: RwLock<HashMap<u32, HotkeyAction>>,
}

#[derive(Debug, Clone)]
struct OverlaySession {
    screenshot: ScreenshotPayload,
    restore_main_window: bool,
}

impl AppState {
    pub fn new(config: AppConfig, history: HistoryStore) -> Result<Self> {
        Self::with_config_path(config, history, None)
    }

    pub fn with_resource_dir(
        config: AppConfig,
        history: HistoryStore,
        resource_dir: Option<PathBuf>,
    ) -> Result<Self> {
        Self::build(config, history, None, resource_dir)
    }

    pub fn with_config_path(
        config: AppConfig,
        history: HistoryStore,
        config_path: Option<PathBuf>,
    ) -> Result<Self> {
        Self::build(config, history, config_path, None)
    }

    fn build(
        config: AppConfig,
        history: HistoryStore,
        config_path: Option<PathBuf>,
        resource_dir: Option<PathBuf>,
    ) -> Result<Self> {
        let config = config.normalized_for_save();
        config.validate()?;
        let ocr = OcrEngine::new(resolve_model_dir(&config, resource_dir.as_deref()))?;
        let translator = TranslatorRegistry::new(config.translator.clone());
        Ok(Self {
            config_path,
            resource_dir,
            config: RwLock::new(config),
            history: Mutex::new(history),
            ocr: RwLock::new(ocr),
            screencap: Screencap::new()?,
            selection: SelectionWatcher::new()?,
            pending_overlay: Mutex::new(None),
            translator: RwLock::new(translator),
            #[cfg(test)]
            fake_translated_text: Mutex::new(None),
            #[cfg(not(test))]
            hotkey_routes: RwLock::new(HashMap::new()),
        })
    }
}

#[cfg(not(test))]
pub fn run_tauri(config: AppConfig, history: HistoryStore) -> Result<()> {
    let hotkeys = configured_hotkeys(&config);
    let hotkey_routes = configured_hotkey_routes(&config)?;

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(hotkeys.iter().map(|(_, shortcut)| shortcut.as_str()))
                .map_err(|err| Error::Config(err.to_string()))?
                .with_handler(move |app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }

                    let action = app
                        .try_state::<AppState>()
                        .and_then(|state| hotkey_action_for_event_id(state.inner(), event.id));
                    let Some(action) = action else {
                        tracing::warn!(
                            shortcut = %shortcut,
                            id = event.id,
                            "global hotkey event did not match current config"
                        );
                        return;
                    };

                    handle_global_hotkey(app.clone(), action);
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_history,
            clear_history,
            get_config,
            get_overlay_screenshot,
            clear_overlay_screenshot,
            screenshot_full,
            screenshot_region,
            start_screenshot_overlay,
            update_config,
            get_desktop_capabilities,
            validate_ocr_models,
            check_ocr_worker,
            check_tts_worker,
            synthesize_text,
            translate_image_base64,
            translate_screenshot_base64,
            translate_screenshot_region,
            ocr_image_region,
            ocr_screenshot_region,
            ocr_overlay_selection,
            translate_overlay_selection,
            close_overlay,
            pin_result_window,
            unpin_result_window,
            translate_current_selection,
            translate_text,
            translate_selection,
            retranslate_result_text
        ])
        .setup(|app| {
            let resource_dir = app.handle().path().resource_dir().ok();
            let app_state = AppState::with_resource_dir(config, history, resource_dir.clone())?;
            *app_state
                .hotkey_routes
                .write()
                .map_err(|err| Error::Config(err.to_string()))? = hotkey_routes;
            app.manage(app_state);
            setup_tray(app.handle())?;

            let state = app.state::<AppState>();
            let config = state
                .inner()
                .config
                .read()
                .map_err(|err| Error::Config(err.to_string()))?;
            tracing::info!(
                target_lang = %config.target_lang.0,
                "SnapText desktop shell initialized"
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_err(|err| snaptext_core::Error::Config(err.to_string()))
}

#[cfg(not(test))]
fn setup_tray(app: &AppHandle) -> Result<()> {
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

#[cfg(all(not(test), not(target_os = "macos")))]
fn setup_overlay_window(app: &AppHandle) -> Result<()> {
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
fn setup_overlay_window(_app: &AppHandle) -> Result<()> {
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
enum TrayAction {
    Show,
    Hide,
    Quit,
}

fn tray_action_for_id(id: &str) -> Option<TrayAction> {
    match id {
        TRAY_SHOW => Some(TrayAction::Show),
        TRAY_HIDE => Some(TrayAction::Hide),
        TRAY_QUIT => Some(TrayAction::Quit),
        _ => None,
    }
}

#[cfg(not(test))]
fn configured_hotkeys(config: &AppConfig) -> Vec<(HotkeyAction, String)> {
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

#[cfg(not(test))]
fn configured_hotkey_routes(config: &AppConfig) -> Result<HashMap<u32, HotkeyAction>> {
    configured_hotkeys(&config)
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

#[cfg(not(test))]
fn hotkey_action_for_event_id(state: &AppState, id: u32) -> Option<HotkeyAction> {
    state.hotkey_routes.read().ok()?.get(&id).copied()
}

#[cfg(not(test))]
fn handle_global_hotkey(app: AppHandle, action: HotkeyAction) {
    tracing::info!(?action, "global hotkey action triggered");
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let result = match action {
            HotkeyAction::Screenshot => start_screenshot_overlay_inner(&app, state.inner())
                .await
                .map(|_| ()),
            HotkeyAction::Selection => match current_selection_text_inner(state.inner()).await {
                Ok(payload) => show_main_window(&app).map(|_| emit_selection_text(&app, &payload)),
                Err(err) => {
                    emit_selection_failure(&app, &err);
                    Err(err)
                }
            },
        };

        if let Err(err) = result {
            tracing::warn!(error = %err, "global hotkey action failed");
        }
    });
}

#[cfg(not(test))]
fn refresh_global_hotkeys(app: &AppHandle, config: &AppConfig) -> Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

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

#[cfg(test)]
fn refresh_global_hotkeys(_app: &AppHandle, _config: &AppConfig) -> Result<()> {
    Ok(())
}

#[cfg(test)]
pub fn run_tauri(config: AppConfig, history: HistoryStore) -> Result<()> {
    let _ = AppState::new(config, history)?;
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
fn get_history(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<HistoryRecord>> {
    let history = state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?;
    history.recent(limit.unwrap_or(50))
}

#[tauri::command]
#[allow(dead_code)]
fn clear_history(state: State<'_, AppState>) -> Result<()> {
    let history = state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?;
    history.clear()
}

#[tauri::command]
#[allow(dead_code)]
fn get_config(state: State<'_, AppState>) -> Result<AppConfig> {
    get_config_inner(state.inner())
}

#[tauri::command]
#[allow(dead_code)]
fn update_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<AppConfig> {
    let config = update_config_inner(state.inner(), config)?;
    refresh_global_hotkeys(&app, &config)?;
    Ok(config)
}

#[tauri::command]
#[allow(dead_code)]
fn validate_ocr_models(state: State<'_, AppState>) -> Result<OcrModelStatus> {
    validate_ocr_models_inner(state.inner())
}

#[tauri::command]
#[allow(dead_code)]
fn check_ocr_worker(state: State<'_, AppState>) -> OcrWorkerStatus {
    check_ocr_worker_inner(state.inner())
}

#[tauri::command]
#[allow(dead_code)]
fn check_tts_worker(state: State<'_, AppState>) -> TtsWorkerStatus {
    check_tts_worker_inner(state.inner())
}

#[tauri::command]
#[allow(dead_code)]
fn synthesize_text(
    state: State<'_, AppState>,
    text: String,
    lang: String,
    provider: Option<String>,
) -> Result<TtsSynthesisResult> {
    synthesize_text_inner(state.inner(), text, lang, provider)
}

#[tauri::command]
#[allow(dead_code)]
fn get_desktop_capabilities(state: State<'_, AppState>) -> Vec<DesktopCapabilityStatus> {
    desktop_capabilities(state.inner())
}

#[tauri::command]
#[allow(dead_code)]
async fn screenshot_full(state: State<'_, AppState>) -> Result<ScreenshotPayload> {
    screenshot_full_inner(state.inner()).await
}

#[tauri::command]
#[allow(dead_code)]
async fn screenshot_region(
    state: State<'_, AppState>,
    bbox: snaptext_core::ocr::BBox,
) -> Result<ScreenshotPayload> {
    screenshot_region_inner(state.inner(), bbox).await
}

#[tauri::command]
#[allow(dead_code)]
async fn start_screenshot_overlay(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScreenshotPayload> {
    start_screenshot_overlay_inner(&app, state.inner()).await
}

async fn start_screenshot_overlay_inner(
    app: &AppHandle,
    state: &AppState,
) -> Result<ScreenshotPayload> {
    #[cfg(target_os = "macos")]
    {
        return start_native_screenshot_selection_inner(app, state).await;
    }

    #[cfg(not(target_os = "macos"))]
    {
        start_webview_screenshot_overlay_inner(app, state).await
    }
}

#[cfg(target_os = "macos")]
async fn start_native_screenshot_selection_inner(
    app: &AppHandle,
    state: &AppState,
) -> Result<ScreenshotPayload> {
    let restore_main_window = main_window_is_visible(app);
    hide_overlay_window(app)?;
    hide_main_window(app)?;
    tokio::time::sleep(Duration::from_millis(MAIN_WINDOW_HIDE_SETTLE_MS)).await;

    let capture = capture_macos_interactive_screenshot();
    restore_main_window_if_needed(app, restore_main_window)?;

    let (payload, image) = capture?;
    emit_overlay_ocr_started(app, payload_to_full_region(&payload));
    match ocr_dynamic_image_inner(state, image) {
        Ok(result) => emit_overlay_ocr(app, result, payload_to_full_region(&payload)),
        Err(err) => {
            emit_overlay_ocr_failed(app, payload_to_full_region(&payload));
            return Err(err);
        }
    }
    Ok(payload)
}

#[cfg(not(target_os = "macos"))]
async fn start_webview_screenshot_overlay_inner(
    app: &AppHandle,
    state: &AppState,
) -> Result<ScreenshotPayload> {
    let restore_main_window = main_window_is_visible(app);
    hide_main_window(app)?;
    // macOS may not remove the window from the compositor immediately after hide().
    // Waiting briefly prevents the overlay screenshot from capturing SnapText itself.
    tokio::time::sleep(Duration::from_millis(MAIN_WINDOW_HIDE_SETTLE_MS)).await;
    let payload = match screenshot_full_inner(state).await {
        Ok(payload) => payload,
        Err(err) => {
            restore_main_window_if_needed(app, restore_main_window)?;
            return Err(err);
        }
    };

    {
        let mut pending = state
            .pending_overlay
            .lock()
            .map_err(|err| Error::Config(err.to_string()))?;
        *pending = Some(OverlaySession {
            screenshot: payload.clone(),
            restore_main_window,
        });
    }

    show_overlay_window(app)?;
    Ok(payload)
}

#[tauri::command]
#[allow(dead_code)]
fn get_overlay_screenshot(state: State<'_, AppState>) -> Result<Option<ScreenshotPayload>> {
    let pending = state
        .pending_overlay
        .lock()
        .map_err(|err| Error::Config(err.to_string()))?;
    Ok(pending.as_ref().map(|session| session.screenshot.clone()))
}

#[tauri::command]
#[allow(dead_code)]
fn clear_overlay_screenshot(state: State<'_, AppState>) -> Result<()> {
    let mut pending = state
        .pending_overlay
        .lock()
        .map_err(|err| Error::Config(err.to_string()))?;
    *pending = None;
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
async fn translate_selection(state: State<'_, AppState>, text: String) -> Result<HistoryRecord> {
    translate_selection_inner(state.inner(), text).await
}

#[tauri::command]
#[allow(dead_code)]
async fn translate_text(
    state: State<'_, AppState>,
    source_text: String,
    target_lang: Option<String>,
) -> Result<HistoryRecord> {
    translate_text_inner(state.inner(), source_text, target_lang).await
}

#[tauri::command]
#[allow(dead_code)]
async fn translate_current_selection(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<HistoryRecord> {
    let record = translate_current_selection_inner(state.inner()).await?;
    emit_selection_record(&app, &record);
    Ok(record)
}

#[tauri::command]
#[allow(dead_code)]
async fn retranslate_result_text(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    source_text: String,
    target_lang: Option<String>,
) -> Result<HistoryRecord> {
    let source = parse_history_source(&source)?;
    let record =
        retranslate_result_text_inner(state.inner(), source, source_text, target_lang).await?;
    match record.source {
        HistorySource::Text | HistorySource::Selection => emit_selection_record(&app, &record),
        HistorySource::Screenshot | HistorySource::Image => {
            emit_result_translation(&app, &history_record_to_translation_result(&record))
        }
    }
    Ok(record)
}

#[tauri::command]
#[allow(dead_code)]
async fn translate_image_base64(
    app: AppHandle,
    state: State<'_, AppState>,
    base64_png: String,
) -> Result<TranslationResult> {
    let result = translate_image_base64_inner(state.inner(), base64_png).await?;
    emit_result_translation(&app, &result);
    Ok(result)
}

#[tauri::command]
#[allow(dead_code)]
async fn translate_screenshot_base64(
    app: AppHandle,
    state: State<'_, AppState>,
    base64_png: String,
) -> Result<TranslationResult> {
    let result = translate_screenshot_base64_inner(state.inner(), base64_png).await?;
    emit_result_translation(&app, &result);
    Ok(result)
}

#[tauri::command]
#[allow(dead_code)]
async fn translate_screenshot_region(
    app: AppHandle,
    state: State<'_, AppState>,
    bbox: snaptext_core::ocr::BBox,
) -> Result<TranslationResult> {
    let result = translate_screenshot_region_inner(state.inner(), bbox).await?;
    emit_result_translation(&app, &result);
    Ok(result)
}

#[tauri::command]
#[allow(dead_code)]
async fn ocr_image_region(
    state: State<'_, AppState>,
    base64_png: String,
    bbox: snaptext_core::ocr::BBox,
) -> Result<OcrTextResult> {
    ocr_image_region_inner(state.inner(), base64_png, bbox).await
}

#[tauri::command]
#[allow(dead_code)]
async fn ocr_screenshot_region(
    state: State<'_, AppState>,
    bbox: snaptext_core::ocr::BBox,
) -> Result<OcrTextResult> {
    ocr_screenshot_region_inner(state.inner(), bbox).await
}

#[tauri::command]
#[allow(dead_code)]
async fn ocr_overlay_selection(
    app: AppHandle,
    state: State<'_, AppState>,
    bbox: snaptext_core::ocr::BBox,
) -> Result<OcrTextResult> {
    let restore_main_window = overlay_restore_main_window(state.inner())?;
    hide_overlay_window(&app)?;
    restore_main_window_if_needed(&app, restore_main_window)?;

    let result = ocr_overlay_selection_inner(state.inner(), bbox).await?;
    emit_overlay_ocr(&app, result.clone(), bbox);
    Ok(result)
}

#[tauri::command]
#[allow(dead_code)]
async fn translate_overlay_selection(
    app: AppHandle,
    state: State<'_, AppState>,
    bbox: snaptext_core::ocr::BBox,
) -> Result<TranslationResult> {
    let result = translate_overlay_selection_inner(state.inner(), bbox).await?;
    let event = OverlayTranslationPayload {
        result: result.clone(),
        region: bbox,
    };
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, OVERLAY_TRANSLATION_EVENT, event.clone()) {
        tracing::warn!(error = %err, "failed to emit overlay translation result");
    }
    emit_result_translation(&app, &result);
    Ok(result)
}

#[tauri::command]
#[allow(dead_code)]
fn close_overlay(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let restore_main_window = {
        let mut pending = state
            .pending_overlay
            .lock()
            .map_err(|err| Error::Config(err.to_string()))?;
        let restore_main_window = pending
            .as_ref()
            .map(|session| session.restore_main_window)
            .unwrap_or(false);
        *pending = None;
        restore_main_window
    };
    hide_overlay_window(&app)?;
    restore_main_window_if_needed(&app, restore_main_window)
}

#[tauri::command]
#[allow(dead_code)]
fn pin_result_window(app: AppHandle) -> Result<()> {
    set_main_window_always_on_top(&app, true)?;
    emit_result_window_state(&app, true)?;
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
fn unpin_result_window(app: AppHandle) -> Result<()> {
    set_main_window_always_on_top(&app, false)?;
    emit_result_window_state(&app, false)?;
    Ok(())
}

fn set_main_window_always_on_top(app: &AppHandle, always_on_top: bool) -> Result<()> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| Error::Config("main window is not available".to_owned()))?;
    window
        .set_always_on_top(always_on_top)
        .map_err(|err| Error::Config(err.to_string()))
}

fn emit_result_window_state(app: &AppHandle, pinned: bool) -> Result<()> {
    for target in result_window_state_targets() {
        app.emit_to(target, RESULT_WINDOW_STATE_EVENT, pinned)
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

fn result_window_state_targets() -> [&'static str; 1] {
    [MAIN_WINDOW_LABEL]
}

fn emit_result_translation(app: &AppHandle, result: &TranslationResult) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, RESULT_TRANSLATION_EVENT, result.clone()) {
        tracing::warn!(error = %err, "failed to emit result translation to main window");
    }
}

fn emit_selection_record(app: &AppHandle, record: &HistoryRecord) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, RESULT_SELECTION_EVENT, record.clone()) {
        tracing::warn!(error = %err, "failed to emit selection result to main window");
    }
}

#[cfg(not(test))]
fn emit_selection_text(app: &AppHandle, payload: &SelectionTextPayload) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, SELECTION_TEXT_EVENT, payload.clone()) {
        tracing::warn!(error = %err, "failed to emit selection text to main window");
    }
}

#[cfg(not(test))]
fn emit_selection_failure(app: &AppHandle, error: &Error) {
    let payload = SelectionFailurePayload {
        message: selection_failure_message(error),
    };
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, RESULT_SELECTION_FAILED_EVENT, payload) {
        tracing::warn!(error = %err, "failed to emit selection failure to main window");
    }
}

fn selection_failure_message(error: &Error) -> String {
    let message = error.to_string();
    if message.contains("Accessibility permission is required") {
        return "需要先授权系统辅助功能权限。请在系统设置 -> 隐私与安全性 -> 辅助功能 中允许 SnapText，然后重新使用划词。".to_owned();
    }
    if message.contains("no selected text is available") {
        return "未读取到选中文本，请先选中文本后再使用划词。".to_owned();
    }
    message
}

#[cfg(target_os = "macos")]
fn emit_overlay_ocr_started(app: &AppHandle, region: snaptext_core::ocr::BBox) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, OVERLAY_OCR_STARTED_EVENT, region) {
        tracing::warn!(error = %err, "failed to emit overlay OCR started");
    }
}

#[cfg(target_os = "macos")]
fn emit_overlay_ocr_failed(app: &AppHandle, region: snaptext_core::ocr::BBox) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, OVERLAY_OCR_FAILED_EVENT, region) {
        tracing::warn!(error = %err, "failed to emit overlay OCR failure");
    }
}

fn emit_overlay_ocr(app: &AppHandle, result: OcrTextResult, region: snaptext_core::ocr::BBox) {
    let event = OverlayOcrPayload { result, region };
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, OVERLAY_OCR_EVENT, event) {
        tracing::warn!(error = %err, "failed to emit overlay OCR result");
    }
}

fn parse_history_source(source: &str) -> Result<HistorySource> {
    match source.trim() {
        "text" => Ok(HistorySource::Text),
        "screenshot" => Ok(HistorySource::Screenshot),
        "selection" => Ok(HistorySource::Selection),
        "image" => Ok(HistorySource::Image),
        _ => Err(Error::Config(format!(
            "unsupported history source: {source}"
        ))),
    }
}

fn history_record_to_translation_result(record: &HistoryRecord) -> TranslationResult {
    TranslationResult {
        source: record.source.clone(),
        source_text: record.source_text.clone(),
        translated_text: record.translated_text.clone(),
        target_lang: record.target_lang.clone(),
        text_lines: Vec::new(),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct OverlayTranslationPayload {
    pub result: TranslationResult,
    pub region: snaptext_core::ocr::BBox,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct OverlayOcrPayload {
    pub result: OcrTextResult,
    pub region: snaptext_core::ocr::BBox,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SelectionFailurePayload {
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SelectionTextPayload {
    pub text: String,
    pub app_bundle_id: Option<String>,
}

async fn translate_text_inner(
    state: &AppState,
    text: String,
    target_lang: Option<String>,
) -> Result<HistoryRecord> {
    translate_text_with_source_inner(state, text, HistorySource::Text, target_lang).await
}

async fn translate_selection_inner(state: &AppState, text: String) -> Result<HistoryRecord> {
    let text = normalize_selection_text_for_translation(text)?;

    translate_text_with_source_inner(state, text, HistorySource::Selection, None).await
}

async fn translate_text_with_source_inner(
    state: &AppState,
    text: String,
    source: HistorySource,
    target_lang: Option<String>,
) -> Result<HistoryRecord> {
    let text = normalize_selection_text_for_translation(text)?;

    let translator = {
        state
            .translator
            .read()
            .map_err(|err| Error::Translate(err.to_string()))?
            .clone()
    };
    let target_lang = target_lang
        .map(|value| Lang(value.trim().to_owned()))
        .filter(|value| !value.0.is_empty())
        .unwrap_or_else(|| {
            state
                .config
                .read()
                .map(|config| config.target_lang.clone())
                .unwrap_or_else(|_| Lang("en".to_owned()))
        });
    ensure_supported_target_lang_for_translation(&target_lang)?;
    let request = TranslateRequest {
        texts: vec![text.clone()],
        source: None,
        target: target_lang.clone(),
    };
    let translated_text = translate_first_text_for_history(state, translator, request).await?;

    let history = state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?;

    // Keep history writes behind the command boundary so every translated
    // text request has the same persistence behavior as screenshot and image flows.
    history.insert(NewHistoryRecord {
        source,
        source_text: text.clone(),
        target_lang: target_lang.0,
        translated_text,
    })
}

fn ensure_supported_target_lang_for_translation(target_lang: &Lang) -> Result<()> {
    if target_lang.0.trim().is_empty() {
        return Err(Error::Config("target language cannot be empty".to_owned()));
    }
    Ok(())
}

async fn translate_first_text_for_history(
    _state: &AppState,
    translator: TranslatorRegistry,
    request: TranslateRequest,
) -> Result<String> {
    #[cfg(test)]
    if let Some(translated_text) = take_fake_translated_text(_state) {
        snaptext_core::translate::validate_translate_request(&request)?;
        return Ok(translated_text);
    }

    let translation = translator.translate(request).await?;
    first_translated_text(&translation.translated_texts)
}

fn normalize_selection_text_for_translation(text: String) -> Result<String> {
    let text = normalize_selection_text(text);
    if text.is_empty() {
        return Err(Error::Translate("selected text cannot be empty".to_owned()));
    }

    Ok(text)
}

async fn retranslate_result_text_inner(
    state: &AppState,
    source: HistorySource,
    source_text: String,
    target_lang: Option<String>,
) -> Result<HistoryRecord> {
    if source_text.trim().is_empty() {
        return Err(Error::Translate(
            "source text for retranslating cannot be empty".to_owned(),
        ));
    }

    let translator = {
        state
            .translator
            .read()
            .map_err(|err| Error::Translate(err.to_string()))?
            .clone()
    };
    let target_lang = target_lang
        .map(|value| Lang(value.trim().to_owned()))
        .filter(|value| !value.0.is_empty())
        .unwrap_or_else(|| {
            state
                .config
                .read()
                .map(|config| config.target_lang.clone())
                .unwrap_or_else(|_| Lang("en".to_owned()))
        });
    ensure_supported_target_lang_for_translation(&target_lang)?;
    let translation = translator
        .translate(TranslateRequest {
            texts: vec![source_text.clone()],
            source: None,
            target: target_lang.clone(),
        })
        .await?;
    let translated_text = first_translated_text(&translation.translated_texts)?;

    state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?
        .insert(NewHistoryRecord {
            source,
            source_text,
            target_lang: target_lang.0,
            translated_text,
        })
}

async fn translate_current_selection_inner(state: &AppState) -> Result<HistoryRecord> {
    translate_optional_selection_inner(state, state.selection.current_selection().await?).await
}

#[cfg(not(test))]
async fn current_selection_text_inner(state: &AppState) -> Result<SelectionTextPayload> {
    ensure_selection_permission()?;
    selection_text_payload_from_optional(state.selection.current_selection().await?)
}

fn selection_text_payload_from_optional(
    selection: Option<SelectionEvent>,
) -> Result<SelectionTextPayload> {
    let selection =
        selection.ok_or_else(|| Error::Selection("no selected text is available".to_owned()))?;
    let text = normalize_selection_text_for_translation(selection.text)?;
    Ok(SelectionTextPayload {
        text,
        app_bundle_id: selection.app_bundle_id,
    })
}

async fn translate_optional_selection_inner(
    state: &AppState,
    selection: Option<SelectionEvent>,
) -> Result<HistoryRecord> {
    let selection =
        selection.ok_or_else(|| Error::Selection("no selected text is available".to_owned()))?;
    translate_selection_inner(state, selection.text).await
}

async fn translate_image_base64_inner(
    state: &AppState,
    base64_png: String,
) -> Result<TranslationResult> {
    translate_base64_image_inner(state, base64_png, HistorySource::Image).await
}

async fn translate_screenshot_base64_inner(
    state: &AppState,
    base64_png: String,
) -> Result<TranslationResult> {
    translate_base64_image_inner(state, base64_png, HistorySource::Screenshot).await
}

async fn translate_screenshot_region_inner(
    state: &AppState,
    bbox: snaptext_core::ocr::BBox,
) -> Result<TranslationResult> {
    let image = state.screencap.capture_region(bbox).await?;
    translate_dynamic_image_inner(
        state,
        DynamicImage::ImageRgba8(image),
        HistorySource::Screenshot,
    )
    .await
}

async fn translate_overlay_selection_inner(
    state: &AppState,
    bbox: snaptext_core::ocr::BBox,
) -> Result<TranslationResult> {
    let pending = {
        state
            .pending_overlay
            .lock()
            .map_err(|err| Error::Config(err.to_string()))?
            .clone()
    };
    let Some(session) = pending else {
        return Err(Error::Image(
            "no active screenshot overlay is available".to_owned(),
        ));
    };

    let image = png_payload_to_image(&session.screenshot.base64_png)?;
    let cropped = crop_image(&image, bbox)?;
    translate_dynamic_image_inner(state, cropped, HistorySource::Screenshot).await
}

fn overlay_restore_main_window(state: &AppState) -> Result<bool> {
    let pending = state
        .pending_overlay
        .lock()
        .map_err(|err| Error::Config(err.to_string()))?;
    Ok(pending
        .as_ref()
        .map(|session| session.restore_main_window)
        .unwrap_or(false))
}

async fn ocr_overlay_selection_inner(
    state: &AppState,
    bbox: snaptext_core::ocr::BBox,
) -> Result<OcrTextResult> {
    let pending = {
        state
            .pending_overlay
            .lock()
            .map_err(|err| Error::Config(err.to_string()))?
            .clone()
    };
    let Some(session) = pending else {
        return Err(Error::Image(
            "no active screenshot overlay is available".to_owned(),
        ));
    };

    let image = png_payload_to_image(&session.screenshot.base64_png)?;
    let cropped = crop_image(&image, bbox)?;
    ocr_dynamic_image_inner(state, cropped)
}

#[cfg(target_os = "macos")]
fn payload_to_full_region(payload: &ScreenshotPayload) -> snaptext_core::ocr::BBox {
    snaptext_core::ocr::BBox {
        x: 0,
        y: 0,
        width: payload.meta.width,
        height: payload.meta.height,
    }
}

async fn ocr_image_region_inner(
    state: &AppState,
    base64_png: String,
    bbox: snaptext_core::ocr::BBox,
) -> Result<OcrTextResult> {
    let image = base64_image_to_dynamic_image(&base64_png)?;
    let cropped = crop_image(&image, bbox)?;
    ocr_dynamic_image_inner(state, cropped)
}

async fn ocr_screenshot_region_inner(
    state: &AppState,
    bbox: snaptext_core::ocr::BBox,
) -> Result<OcrTextResult> {
    let image = state.screencap.capture_region(bbox).await?;
    ocr_dynamic_image_inner(state, DynamicImage::ImageRgba8(image))
}

async fn translate_base64_image_inner(
    state: &AppState,
    base64_png: String,
    source: HistorySource,
) -> Result<TranslationResult> {
    let image = base64_image_to_dynamic_image(&base64_png)?;
    translate_dynamic_image_inner(state, image, source).await
}

fn png_payload_to_image(base64_png: &str) -> Result<DynamicImage> {
    base64_image_to_dynamic_image(base64_png)
}

fn base64_image_to_dynamic_image(base64_image: &str) -> Result<DynamicImage> {
    let base64_image = image_payload_base64_segment(base64_image)?;
    if base64_image.is_empty() {
        return Err(Error::Image("image payload cannot be empty".to_owned()));
    }
    if base64_image.len() > max_base64_payload_chars() {
        return Err(Error::Image(format!(
            "image payload is too large. Use an image under {} bytes.",
            MAX_IMAGE_PAYLOAD_BYTES
        )));
    }

    let bytes = STANDARD
        .decode(base64_image)
        .map_err(|err| Error::Image(format!("image payload is not valid base64: {err}")))?;
    if bytes.is_empty() {
        return Err(Error::Image("image payload cannot be empty".to_owned()));
    }
    if bytes.len() > MAX_IMAGE_PAYLOAD_BYTES {
        return Err(Error::Image(format!(
            "image payload is too large: {} bytes. Use an image under {} bytes.",
            bytes.len(),
            MAX_IMAGE_PAYLOAD_BYTES
        )));
    }

    let format = image::guess_format(&bytes).map_err(|err| {
        Error::Image(format!("image payload format could not be detected: {err}"))
    })?;
    if !is_supported_image_format(format) {
        return Err(Error::Image(format!(
            "unsupported image format: {format:?}. Use PNG, JPEG, or WebP."
        )));
    }

    let image = image::load_from_memory(&bytes)?;
    validate_decoded_image_dimensions(&image)?;
    Ok(image)
}

fn is_supported_image_format(format: ImageFormat) -> bool {
    matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    )
}

fn max_base64_payload_chars() -> usize {
    MAX_IMAGE_PAYLOAD_BYTES.div_ceil(3) * 4
}

fn validate_decoded_image_dimensions(image: &DynamicImage) -> Result<()> {
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Image("image cannot be empty".to_owned()));
    }
    let pixels = u64::from(image.width()) * u64::from(image.height());
    if pixels > MAX_IMAGE_PIXELS {
        return Err(Error::Image(format!(
            "image is too large: {}x{} pixels. Crop or resize below {} pixels.",
            image.width(),
            image.height(),
            MAX_IMAGE_PIXELS
        )));
    }
    Ok(())
}

fn image_payload_base64_segment(payload: &str) -> Result<&str> {
    let payload = payload.trim();
    if payload.is_empty() {
        return Err(Error::Image("image payload cannot be empty".to_owned()));
    }

    let Some(data_url) = payload.strip_prefix("data:") else {
        return Ok(payload);
    };
    let (metadata, base64_payload) = data_url
        .split_once(',')
        .ok_or_else(|| Error::Image("image data URL is missing base64 payload".to_owned()))?;
    validate_image_data_url_metadata(metadata)?;

    Ok(base64_payload.trim())
}

fn validate_image_data_url_metadata(metadata: &str) -> Result<()> {
    let mut parts = metadata.split(';').map(str::trim);
    let media_type = parts.next().unwrap_or_default();
    if !is_supported_image_data_url_media_type(media_type) {
        return Err(Error::Image(format!(
            "image data URL media type `{media_type}` is not supported. Use image/png, image/jpeg, or image/webp."
        )));
    }
    if !parts.any(|part| part.eq_ignore_ascii_case("base64")) {
        return Err(Error::Image(
            "image data URL must be base64 encoded".to_owned(),
        ));
    }

    Ok(())
}

fn is_supported_image_data_url_media_type(media_type: &str) -> bool {
    matches!(
        media_type.to_ascii_lowercase().as_str(),
        "image/png" | "image/jpeg" | "image/webp"
    )
}

fn crop_image(image: &DynamicImage, bbox: snaptext_core::ocr::BBox) -> Result<DynamicImage> {
    if bbox.width == 0 || bbox.height == 0 {
        return Err(Error::Image("capture region cannot be empty".to_owned()));
    }

    let image_width = image.width();
    let image_height = image.height();
    if bbox.x >= image_width || bbox.y >= image_height {
        return Err(Error::Image(
            "capture region is outside the screenshot".to_owned(),
        ));
    }

    let width = bbox.width.min(image_width.saturating_sub(bbox.x)).max(1);
    let height = bbox.height.min(image_height.saturating_sub(bbox.y)).max(1);
    Ok(image.crop_imm(bbox.x, bbox.y, width, height))
}

#[cfg(target_os = "macos")]
fn capture_macos_interactive_screenshot() -> Result<(ScreenshotPayload, DynamicImage)> {
    let tempdir = tempfile::tempdir()?;
    let image_path = tempdir.path().join("snaptext-native-selection.png");
    let output = Command::new("screencapture")
        .arg("-i")
        .arg("-s")
        .arg("-Jselection")
        .arg("-x")
        .arg("-tpng")
        .arg(&image_path)
        .output()
        .map_err(|err| Error::Image(format!("failed to start macOS screenshot selector: {err}")))?;

    if !output.status.success() || !image_path.is_file() {
        return Err(Error::Image(mac_screenshot_selection_error(
            output.status.code(),
            &output.stderr,
        )));
    }

    let image = image::open(&image_path)
        .map_err(|err| Error::Image(format!("failed to read selected screenshot: {err}")))?;
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Image("selected screenshot is empty".to_owned()));
    }

    // The UI still receives a payload for preview/history consistency, while
    // the backend uses the same selected pixels for OCR and translation.
    let payload = ScreenshotPayload::from_image(image.to_rgba8())?;
    Ok((payload, image))
}

#[cfg(target_os = "macos")]
fn mac_screenshot_selection_error(status_code: Option<i32>, stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_owned();
    if message.is_empty() {
        return format!(
            "screenshot selection produced no image; status={}",
            status_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "terminated".to_owned())
        );
    }
    format!("screenshot selection failed: {message}")
}

#[cfg(not(target_os = "macos"))]
fn show_overlay_window(app: &AppHandle) -> Result<()> {
    setup_overlay_window(app)?;
    let window = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .ok_or_else(|| Error::Config("overlay window is not available".to_owned()))?;

    // Re-apply overlay window state before every show. Some macOS WebView windows
    // can retain ordinary chrome when a hidden helper window is reused.
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

#[cfg(all(not(test), not(target_os = "macos")))]
fn hide_overlay_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

#[cfg(any(test, target_os = "macos"))]
fn hide_overlay_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

#[cfg(not(test))]
fn hide_main_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
fn hide_main_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

#[cfg(not(test))]
fn main_window_is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[cfg(test)]
fn main_window_is_visible(_app: &AppHandle) -> bool {
    false
}

fn restore_main_window_if_needed(app: &AppHandle, should_restore: bool) -> Result<()> {
    if should_restore {
        show_main_window(app)?;
    }
    Ok(())
}

#[cfg(not(test))]
fn show_main_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
fn show_main_window(_app: &AppHandle) -> Result<()> {
    Ok(())
}

async fn translate_dynamic_image_inner(
    state: &AppState,
    image: DynamicImage,
    source: HistorySource,
) -> Result<TranslationResult> {
    let target = {
        state
            .config
            .read()
            .map_err(|err| Error::Config(err.to_string()))?
            .target_lang
            .clone()
    };
    let translator = {
        state
            .translator
            .read()
            .map_err(|err| Error::Translate(err.to_string()))?
            .clone()
    };

    if matches!(source, HistorySource::Selection | HistorySource::Text) {
        return Err(Error::Image(
            "text sources cannot be translated from image data".to_owned(),
        ));
    }

    let ocr_result = ocr_dynamic_image_inner(state, image)?;
    let translation = translator
        .translate(TranslateRequest {
            texts: vec![ocr_result.source_text.clone()],
            source: None,
            target: target.clone(),
        })
        .await?;
    let translated_text = first_translated_text(&translation.translated_texts)?;
    let result = TranslationResult {
        source,
        source_text: ocr_result.source_text,
        translated_text,
        target_lang: target.0,
        text_lines: ocr_result.text_lines,
    };
    let history_record = result.clone().into_history_record();
    state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?
        .insert(history_record)?;

    Ok(result)
}

fn ocr_dynamic_image_inner(state: &AppState, image: DynamicImage) -> Result<OcrTextResult> {
    validate_decoded_image_dimensions(&image)?;
    let worker_path = resolve_ocr_worker_path(state);
    run_ocr_worker_on_image(state, &worker_path, &image)
}

fn resolve_ocr_worker_path(state: &AppState) -> PathBuf {
    if let Ok(path) = std::env::var("SNAPTEXT_OCR_WORKER") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return path;
        }
    }
    state
        .resource_dir
        .as_deref()
        .map(|dir| dir.join(OCR_WORKER_PATH))
        .filter(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(OCR_WORKER_PATH))
}

fn run_ocr_worker_on_image(
    state: &AppState,
    worker_path: &Path,
    image: &DynamicImage,
) -> Result<OcrTextResult> {
    let tempdir = tempfile::tempdir()?;
    let image_path = tempdir.path().join("snaptext-ocr.png");
    image.save_with_format(&image_path, ImageFormat::Png)?;
    let output = Command::new(resolve_python_command(state))
        .arg(worker_path)
        .arg("--image")
        .arg(&image_path)
        .output()
        .map_err(|err| Error::Ocr(format!("failed to start OCR worker: {err}")))?;
    parse_ocr_worker_output(output)
}

fn parse_ocr_worker_output(output: std::process::Output) -> Result<OcrTextResult> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = ocr_worker_error_message(&stderr, &stdout);
        return Err(Error::Ocr(format!("OCR worker failed: {message}")));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result_json = last_json_stdout_line(&stdout)
        .ok_or_else(|| Error::Ocr("OCR worker did not return JSON output.".to_owned()))?;
    let result: OcrTextResult = serde_json::from_str(result_json)
        .map_err(|err| Error::Ocr(format!("OCR worker returned invalid JSON: {err}")))?;
    if result.source_text.trim().is_empty() {
        return Err(Error::Ocr(
            "OCR did not detect any translatable text".to_owned(),
        ));
    }
    Ok(result)
}

fn resolve_python_command(state: &AppState) -> String {
    if let Some(python) = std::env::var(SNAPTEXT_PYTHON_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return python;
    }

    if let Some(python) = discover_project_ocr_python(state) {
        return python.display().to_string();
    }

    String::from("python3")
}

fn discover_project_ocr_python(state: &AppState) -> Option<PathBuf> {
    // Desktop launches often do not inherit the developer shell env. Prefer the
    // project OCR venv so the app keeps using the verified Paddle runtime.
    let from_resource_dir = state
        .resource_dir
        .as_deref()
        .and_then(find_ocr_venv_python_from);
    if from_resource_dir.is_some() {
        return from_resource_dir;
    }

    std::env::current_dir()
        .ok()
        .and_then(|current_dir| find_ocr_venv_python_from(&current_dir))
}

fn find_ocr_venv_python_from(start: &Path) -> Option<PathBuf> {
    find_named_venv_python_from(start, OCR_VENV_PYTHON)
}

fn find_named_venv_python_from(start: &Path, marker: &str) -> Option<PathBuf> {
    for dir in start.ancestors() {
        let python = dir.join(marker);
        if python.is_file() {
            return Some(python);
        }
    }
    None
}

fn last_json_stdout_line(stdout: &str) -> Option<&str> {
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('{') && line.ends_with('}'))
}

fn ocr_worker_error_message(stderr: &str, stdout: &str) -> String {
    let raw = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if let Some(error) = extract_worker_error_json(raw) {
        return error;
    }
    strip_ansi_escape_codes(raw)
}

fn extract_worker_error_json(output: &str) -> Option<String> {
    let start = output.rfind(r#"{"error""#)?;
    let end = output[start..].rfind('}')? + start + 1;
    let payload: serde_json::Value = serde_json::from_str(&output[start..end]).ok()?;
    payload
        .get("error")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn strip_ansi_escape_codes(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for code in chars.by_ref() {
                if code.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }
        output.push(ch);
    }
    output
}

#[cfg(test)]
fn set_fake_translated_text(state: &AppState, value: impl Into<String>) {
    *state
        .fake_translated_text
        .lock()
        .expect("fake translator lock") = Some(value.into());
}

#[cfg(test)]
fn take_fake_translated_text(state: &AppState) -> Option<String> {
    state
        .fake_translated_text
        .lock()
        .expect("fake translator lock")
        .take()
}

fn check_ocr_worker_inner(state: &AppState) -> OcrWorkerStatus {
    let worker_path = resolve_ocr_worker_path(state);
    let python = resolve_python_command(state);
    let output = Command::new(&python)
        .arg(&worker_path)
        .arg("--check")
        .output();

    match output {
        Err(err) => OcrWorkerStatus {
            python_available: false,
            paddleocr_available: false,
            worker_ready: false,
            message: format!("failed to start `{python}`: {err}"),
        },
        Ok(output) if output.status.success() => {
            serde_json::from_slice(&output.stdout).unwrap_or(OcrWorkerStatus {
                python_available: true,
                paddleocr_available: false,
                worker_ready: false,
                message: String::from("OCR worker returned invalid status JSON."),
            })
        }
        Ok(output) => OcrWorkerStatus {
            python_available: true,
            paddleocr_available: false,
            worker_ready: false,
            message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        },
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct OcrTextResult {
    pub source_text: String,
    pub text_lines: Vec<snaptext_core::ocr::TextLine>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OcrWorkerStatus {
    pub python_available: bool,
    pub paddleocr_available: bool,
    pub worker_ready: bool,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct TtsWorkerStatus {
    pub python_available: bool,
    pub coqui_available: bool,
    pub worker_ready: bool,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct TtsSynthesisResult {
    pub audio_path: String,
    pub provider: String,
    pub lang: String,
}

fn synthesize_text_inner(
    state: &AppState,
    text: String,
    lang: String,
    provider: Option<String>,
) -> Result<TtsSynthesisResult> {
    let text = text.trim();
    if text.is_empty() {
        return Err(Error::Speech("speech text cannot be empty".to_owned()));
    }

    let config = state
        .config
        .read()
        .map_err(|err| Error::Config(err.to_string()))?
        .speech
        .clone();
    if !config.enabled {
        return Err(Error::Speech("speech is disabled".to_owned()));
    }

    let requested_provider = provider.unwrap_or_else(|| provider_name(&config.provider).to_owned());
    if requested_provider != "coqui" {
        return Err(Error::Speech(format!(
            "native synthesis only supports coqui, got {requested_provider}"
        )));
    }

    let worker_path = resolve_tts_worker_path(state);
    let tempdir = tempfile::Builder::new()
        .prefix("snaptext-tts-")
        .tempdir()
        .map_err(|err| Error::Speech(format!("failed to create TTS temp dir: {err}")))?;
    let out_path = tempdir.keep().join("speech.wav");
    run_tts_worker(state, &worker_path, text, lang.trim(), &out_path)?;
    Ok(TtsSynthesisResult {
        audio_path: out_path.display().to_string(),
        provider: "coqui".to_owned(),
        lang: lang.trim().to_owned(),
    })
}

fn resolve_tts_worker_path(state: &AppState) -> PathBuf {
    if let Ok(path) = std::env::var("SNAPTEXT_TTS_WORKER") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return path;
        }
    }
    state
        .resource_dir
        .as_deref()
        .map(|dir| dir.join(TTS_WORKER_PATH))
        .filter(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(TTS_WORKER_PATH))
}

fn run_tts_worker(
    state: &AppState,
    worker_path: &Path,
    text: &str,
    lang: &str,
    out_path: &Path,
) -> Result<()> {
    let config = state
        .config
        .read()
        .map_err(|err| Error::Config(err.to_string()))?
        .speech
        .clone();
    let mut command = Command::new(resolve_tts_python_command(state));
    command
        .arg(worker_path)
        .arg("--text")
        .arg(text)
        .arg("--lang")
        .arg(lang)
        .arg("--out")
        .arg(out_path)
        .arg("--model")
        .arg(&config.coqui.model_name);
    if let Some(speaker_wav) = config.coqui.speaker_wav.as_deref() {
        command.arg("--speaker-wav").arg(speaker_wav);
    }
    if let Some(cache_dir) = config.coqui.cache_dir.as_deref() {
        command.arg("--cache-dir").arg(cache_dir);
    }
    let output = command
        .output()
        .map_err(|err| Error::Speech(format!("failed to start TTS worker: {err}")))?;
    parse_tts_worker_output(output, out_path)
}

fn parse_tts_worker_output(output: std::process::Output, expected_path: &Path) -> Result<()> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = ocr_worker_error_message(&stderr, &stdout);
        return Err(Error::Speech(format!("TTS worker failed: {message}")));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result_json = last_json_stdout_line(&stdout)
        .ok_or_else(|| Error::Speech("TTS worker did not return JSON output.".to_owned()))?;
    let payload: serde_json::Value = serde_json::from_str(result_json)
        .map_err(|err| Error::Speech(format!("TTS worker returned invalid JSON: {err}")))?;
    let audio_path = payload
        .get("audio_path")
        .and_then(|value| value.as_str())
        .ok_or_else(|| Error::Speech("TTS worker JSON omitted audio_path.".to_owned()))?;
    if Path::new(audio_path) != expected_path {
        return Err(Error::Speech(
            "TTS worker returned an unexpected audio path.".to_owned(),
        ));
    }
    if !expected_path.is_file() {
        return Err(Error::Speech(
            "TTS worker did not create the audio file.".to_owned(),
        ));
    }
    Ok(())
}

fn check_tts_worker_inner(state: &AppState) -> TtsWorkerStatus {
    let worker_path = resolve_tts_worker_path(state);
    let python = resolve_tts_python_command(state);
    let config = match state.config.read() {
        Ok(config) => config.speech.clone(),
        Err(err) => {
            return TtsWorkerStatus {
                python_available: false,
                coqui_available: false,
                worker_ready: false,
                message: err.to_string(),
            };
        }
    };
    let mut command = Command::new(&python);
    command
        .arg(&worker_path)
        .arg("--check")
        .arg("--model")
        .arg(&config.coqui.model_name);
    if let Some(cache_dir) = config.coqui.cache_dir.as_deref() {
        command.arg("--cache-dir").arg(cache_dir);
    }
    let output = command.output();

    match output {
        Err(err) => TtsWorkerStatus {
            python_available: false,
            coqui_available: false,
            worker_ready: false,
            message: format!("failed to start `{python}`: {err}"),
        },
        Ok(output) if output.status.success() => {
            serde_json::from_slice(&output.stdout).unwrap_or(TtsWorkerStatus {
                python_available: true,
                coqui_available: false,
                worker_ready: false,
                message: String::from("TTS worker returned invalid status JSON."),
            })
        }
        Ok(output) => TtsWorkerStatus {
            python_available: true,
            coqui_available: false,
            worker_ready: false,
            message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        },
    }
}

fn resolve_tts_python_command(state: &AppState) -> String {
    if let Some(python) = state
        .config
        .read()
        .ok()
        .and_then(|config| config.speech.coqui.python.clone())
        .filter(|value| !value.trim().is_empty())
    {
        return python;
    }
    if let Some(python) = std::env::var(SNAPTEXT_TTS_PYTHON_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return python;
    }
    if let Some(python) = discover_project_tts_python(state) {
        return python.display().to_string();
    }
    resolve_python_command(state)
}

fn discover_project_tts_python(state: &AppState) -> Option<PathBuf> {
    let from_resource_dir = state
        .resource_dir
        .as_deref()
        .and_then(|dir| find_named_venv_python_from(dir, TTS_VENV_PYTHON));
    if from_resource_dir.is_some() {
        return from_resource_dir;
    }

    std::env::current_dir()
        .ok()
        .and_then(|current_dir| find_named_venv_python_from(&current_dir, TTS_VENV_PYTHON))
}

fn provider_name(provider: &SpeechProvider) -> &'static str {
    match provider {
        SpeechProvider::System => "system",
        SpeechProvider::Coqui => "coqui",
    }
}

fn get_config_inner(state: &AppState) -> Result<AppConfig> {
    state
        .config
        .read()
        .map(|config| config.clone())
        .map_err(|err| Error::Config(err.to_string()))
}

fn update_config_inner(state: &AppState, config: AppConfig) -> Result<AppConfig> {
    let config = config.normalized_for_save();
    config.validate()?;
    config.save(state.config_path.clone())?;

    {
        let mut current = state
            .config
            .write()
            .map_err(|err| Error::Config(err.to_string()))?;
        *current = config.clone();
    }

    {
        let mut translator = state
            .translator
            .write()
            .map_err(|err| Error::Translate(err.to_string()))?;
        *translator = TranslatorRegistry::new(config.translator.clone());
    }

    {
        let mut ocr = state
            .ocr
            .write()
            .map_err(|err| Error::Ocr(err.to_string()))?;
        *ocr = OcrEngine::new(resolve_model_dir(&config, state.resource_dir.as_deref()))?;
    }

    Ok(config)
}

fn validate_ocr_models_inner(state: &AppState) -> Result<OcrModelStatus> {
    let ocr = state
        .ocr
        .read()
        .map_err(|err| Error::Ocr(err.to_string()))?
        .clone();
    let manifest = ocr.manifest();
    let expected = [
        (&manifest.det, snaptext_core::ocr::DET_MODEL_FILE),
        (&manifest.cls, snaptext_core::ocr::CLS_MODEL_FILE),
        (&manifest.rec, snaptext_core::ocr::REC_MODEL_FILE),
        (&manifest.rec_dict, snaptext_core::ocr::REC_DICT_FILE),
    ];
    let missing_files = expected
        .iter()
        .filter_map(|(path, label)| (!path.is_file()).then_some((*label).to_owned()))
        .collect::<Vec<_>>();

    if !missing_files.is_empty() {
        return Ok(OcrModelStatus {
            model_dir: ocr.model_dir().display().to_string(),
            valid: false,
            missing_files,
            recognition_dict_len: 0,
            loadable: false,
            message: String::from("OCR model directory is missing required files."),
        });
    }

    let assets = ocr.validate_assets()?;
    // Loading every ONNX session catches corrupted or mismatched model files before a
    // screenshot/image translation request reaches the full OCR pipeline.
    if let Err(err) = ocr.load_sessions() {
        return Ok(OcrModelStatus {
            model_dir: ocr.model_dir().display().to_string(),
            valid: false,
            missing_files,
            recognition_dict_len: assets.recognition_dict_len,
            loadable: false,
            message: format!("OCR model files exist, but ONNX sessions failed to load: {err}"),
        });
    }

    Ok(OcrModelStatus {
        model_dir: ocr.model_dir().display().to_string(),
        valid: true,
        missing_files,
        recognition_dict_len: assets.recognition_dict_len,
        loadable: true,
        message: String::from("OCR model files and ONNX sessions are ready."),
    })
}

fn resolve_model_dir(config: &AppConfig, resource_dir: Option<&std::path::Path>) -> PathBuf {
    match &config.ocr.model_dir {
        ModelDir::Bundled(_) => resource_dir
            .map(|dir| dir.join("models"))
            .unwrap_or_else(|| PathBuf::from("models")),
        ModelDir::Custom(path) => path.clone(),
    }
}

async fn screenshot_full_inner(state: &AppState) -> Result<ScreenshotPayload> {
    let image = state.screencap.capture_full_screen().await?;
    ScreenshotPayload::from_image(image)
}

async fn screenshot_region_inner(
    state: &AppState,
    bbox: snaptext_core::ocr::BBox,
) -> Result<ScreenshotPayload> {
    let image = state.screencap.capture_region(bbox).await?;
    ScreenshotPayload::from_image(image)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OcrModelStatus {
    pub model_dir: String,
    pub valid: bool,
    pub missing_files: Vec<String>,
    pub recognition_dict_len: usize,
    pub loadable: bool,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct DesktopCapabilityStatus {
    pub capability: String,
    pub status: String,
    pub action: String,
}

fn desktop_capabilities(state: &AppState) -> Vec<DesktopCapabilityStatus> {
    vec![
        DesktopCapabilityStatus {
            capability: String::from("screenshot"),
            status: platform_screenshot_status(),
            action: platform_screenshot_action(),
        },
        DesktopCapabilityStatus {
            capability: String::from("selection"),
            status: platform_selection_status(),
            action: platform_selection_action(),
        },
        DesktopCapabilityStatus {
            capability: String::from("global_hotkey"),
            status: String::from("configured"),
            action: String::from("Registered through the Tauri global shortcut plugin."),
        },
        DesktopCapabilityStatus {
            capability: String::from("ocr_worker"),
            status: ocr_worker_capability_status(state),
            action: ocr_worker_capability_action(state),
        },
        DesktopCapabilityStatus {
            capability: String::from("tts_worker"),
            status: tts_worker_capability_status(state),
            action: tts_worker_capability_action(state),
        },
    ]
}

fn platform_screenshot_status() -> String {
    #[cfg(target_os = "macos")]
    {
        String::from("requires_screen_recording_permission")
    }
    #[cfg(target_os = "windows")]
    {
        String::from("available")
    }
    #[cfg(target_os = "linux")]
    {
        String::from("depends_on_compositor_portal")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        String::from("unsupported_platform")
    }
}

fn platform_screenshot_action() -> String {
    #[cfg(target_os = "macos")]
    {
        String::from(
            "Grant Screen Recording permission to SnapText in System Settings -> Privacy & Security -> Screen & System Audio Recording, then restart SnapText.",
        )
    }
    #[cfg(target_os = "windows")]
    {
        String::from(
            "No extra OS permission is normally required. If capture fails for an elevated app, restart SnapText with matching privileges.",
        )
    }
    #[cfg(target_os = "linux")]
    {
        String::from(
            "Use an X11 session or a Wayland compositor/portal path supported by xcap; if capture fails, verify desktop portal and compositor screenshot permissions.",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        String::from("SnapText only targets macOS, Windows, and Linux desktops.")
    }
}

fn platform_selection_status() -> String {
    #[cfg(target_os = "macos")]
    {
        String::from(selection_permission_status())
    }
    #[cfg(target_os = "windows")]
    {
        String::from("uses_ui_automation")
    }
    #[cfg(target_os = "linux")]
    {
        String::from("requires_selection_tools")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        String::from("unsupported_platform")
    }
}

fn platform_selection_action() -> String {
    #[cfg(target_os = "macos")]
    {
        String::from(
            "Grant Accessibility permission to SnapText in System Settings -> Privacy & Security -> Accessibility, then restart SnapText.",
        )
    }
    #[cfg(target_os = "windows")]
    {
        String::from(
            "UI Automation is used for focused text controls; elevated apps may need SnapText to run with matching privileges.",
        )
    }
    #[cfg(target_os = "linux")]
    {
        String::from(
            "Install wl-clipboard for Wayland or xclip/xsel for X11, and ensure the selected text is available in PRIMARY or CLIPBOARD.",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        String::from("SnapText only targets macOS, Windows, and Linux desktops.")
    }
}

fn ocr_worker_capability_status(state: &AppState) -> String {
    let status = check_ocr_worker_inner(state);
    if status.worker_ready {
        String::from("ready")
    } else if !status.python_available {
        String::from("python_missing")
    } else if !status.paddleocr_available {
        String::from("paddleocr_missing")
    } else {
        String::from("error")
    }
}

fn ocr_worker_capability_action(state: &AppState) -> String {
    let status = check_ocr_worker_inner(state);
    if status.worker_ready {
        status.message
    } else {
        format!(
            "{} Install the official PaddleOCR Python dependencies, for example: pip install paddleocr paddlepaddle",
            status.message
        )
    }
}

fn tts_worker_capability_status(state: &AppState) -> String {
    let status = check_tts_worker_inner(state);
    if status.worker_ready {
        String::from("ready")
    } else if !status.python_available {
        String::from("python_missing")
    } else if !status.coqui_available {
        String::from("coqui_missing")
    } else {
        String::from("error")
    }
}

fn tts_worker_capability_action(state: &AppState) -> String {
    let status = check_tts_worker_inner(state);
    if status.worker_ready {
        status.message
    } else {
        format!(
            "{} Install the Coqui TTS Python dependency, for example: pip install coqui-tts",
            status.message
        )
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ScreenshotPayload {
    pub meta: ImageMeta,
    pub base64_png: String,
}

impl ScreenshotPayload {
    fn from_image(image: RgbaImage) -> Result<Self> {
        let width = image.width();
        let height = image.height();
        let mut png = Vec::new();
        DynamicImage::ImageRgba8(image).write_to(&mut Cursor::new(&mut png), ImageFormat::Png)?;

        Ok(Self {
            meta: ImageMeta {
                width,
                height,
                path: None,
            },
            base64_png: STANDARD.encode(png),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snaptext_core::config::TranslatorProvider;

    #[tokio::test]
    async fn translate_selection_rejects_empty_text() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err = translate_selection_inner(&state, "   ".to_owned())
            .await
            .expect_err("empty error");

        assert!(err.to_string().contains("selected text cannot be empty"));
    }

    #[tokio::test]
    async fn translate_text_rejects_empty_text() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err = translate_text_inner(&state, "   ".to_owned(), None)
            .await
            .expect_err("empty text");

        assert!(err.to_string().contains("selected text cannot be empty"));
    }

    #[tokio::test]
    async fn translate_text_rejects_oversized_text_before_provider_call() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err = translate_text_inner(
            &state,
            "a".repeat(snaptext_core::translate::MAX_TRANSLATE_TEXT_CHARS + 1),
            None,
        )
        .await
        .expect_err("oversized text");

        assert!(err.to_string().contains("translation text is too long"));
    }

    #[tokio::test]
    async fn translate_text_writes_text_history_source() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");
        set_fake_translated_text(&state, "bonjour");

        let record = translate_text_inner(&state, " hello ".to_owned(), None)
            .await
            .expect("translated text record");

        assert_eq!(record.source, HistorySource::Text);
        assert_eq!(record.source_text, "hello");
        assert_eq!(record.translated_text, "bonjour");
        assert_eq!(
            state
                .history
                .lock()
                .expect("history lock")
                .recent(1)
                .expect("recent history")
                .first()
                .expect("history record")
                .source,
            HistorySource::Text
        );
    }

    #[test]
    fn normalize_selection_text_for_translation_removes_control_edges() {
        let text = normalize_selection_text_for_translation("\0 hello\r\nworld \t".to_owned())
            .expect("normalized text");

        assert_eq!(text, "hello\nworld");
        assert!(!text.contains('\0'));
    }

    #[test]
    fn normalize_selection_text_for_translation_rejects_empty_text() {
        let err = normalize_selection_text_for_translation("\0\r\n\t ".to_owned())
            .expect_err("empty text");

        assert!(err.to_string().contains("selected text cannot be empty"));
    }

    #[tokio::test]
    async fn translate_selection_reports_provider_errors() {
        let mut config = AppConfig::default();
        config.translator.provider = TranslatorProvider::DeepL;
        let state = AppState::new(config, HistoryStore::in_memory().expect("history store"))
            .expect("app state");

        let err = translate_selection_inner(&state, "hello".to_owned())
            .await
            .expect_err("missing API key");

        assert!(err.to_string().contains("API key is required"));
    }

    #[tokio::test]
    async fn translate_selection_rejects_oversized_text_before_provider_call() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err = translate_selection_inner(
            &state,
            "a".repeat(snaptext_core::translate::MAX_TRANSLATE_TEXT_CHARS + 1),
        )
        .await
        .expect_err("oversized selection text");

        assert!(err.to_string().contains("translation text is too long"));
    }

    #[tokio::test]
    async fn translate_current_selection_reports_missing_selection() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err = translate_optional_selection_inner(&state, None)
            .await
            .expect_err("missing selection");

        assert!(err.to_string().contains("no selected text is available"));
    }

    #[test]
    fn selection_text_payload_normalizes_selected_text() {
        let payload = selection_text_payload_from_optional(Some(SelectionEvent {
            text: "\0 hello \r\n world \t".to_owned(),
            app_bundle_id: Some("com.example.editor".to_owned()),
        }))
        .expect("selection payload");

        assert_eq!(payload.text, "hello\nworld");
        assert_eq!(payload.app_bundle_id.as_deref(), Some("com.example.editor"));
    }

    #[test]
    fn selection_failure_message_separates_permission_and_empty_selection() {
        let permission_message = selection_failure_message(&Error::Selection(
            "Accessibility permission is required before reading selected text".to_owned(),
        ));
        assert!(permission_message.contains("授权系统辅助功能权限"));
        assert!(!permission_message.contains("未读取到选中文本"));

        let empty_message = selection_failure_message(&Error::Selection(
            "no selected text is available".to_owned(),
        ));
        assert!(empty_message.contains("请先选中文本"));
        assert!(!empty_message.contains("辅助功能权限"));
    }

    #[tokio::test]
    async fn retranslate_result_text_rejects_empty_source_text() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err =
            retranslate_result_text_inner(&state, HistorySource::Selection, "   ".to_owned(), None)
                .await
                .expect_err("empty source text");

        assert!(
            err.to_string()
                .contains("source text for retranslating cannot be empty")
        );
    }

    #[tokio::test]
    async fn retranslate_result_text_rejects_oversized_source_text_before_provider_call() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err = retranslate_result_text_inner(
            &state,
            HistorySource::Selection,
            "a".repeat(snaptext_core::translate::MAX_TRANSLATE_TEXT_CHARS + 1),
            None,
        )
        .await
        .expect_err("oversized source text");

        assert!(err.to_string().contains("translation text is too long"));
    }

    #[test]
    fn update_config_persists_and_rebuilds_state() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let config_path = tempdir.path().join("config.yaml");
        let mut config = AppConfig::default();
        config.target_lang.0 = "ja".to_owned();
        let state = AppState::with_config_path(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
            Some(config_path.clone()),
        )
        .expect("app state");

        let updated = update_config_inner(&state, config.clone()).expect("updated config");
        let loaded = AppConfig::load_or_default(Some(config_path)).expect("loaded config");

        assert_eq!(updated.target_lang.0, "ja");
        assert_eq!(loaded.target_lang.0, "ja");
        assert_eq!(get_config_inner(&state).expect("state config"), config);
    }

    #[test]
    fn app_state_migrates_removed_translator_providers() {
        let mut config = AppConfig::default();
        config.translator.provider = TranslatorProvider::LocalHttp;
        let state = AppState::new(config, HistoryStore::in_memory().expect("history store"))
            .expect("app state");

        assert_eq!(
            get_config_inner(&state)
                .expect("state config")
                .translator
                .provider,
            TranslatorProvider::SnapTextCloud
        );
    }

    #[test]
    fn update_config_normalizes_saved_and_runtime_values() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let config_path = tempdir.path().join("config.yaml");
        let mut config = AppConfig::default();
        config.target_lang.0 = " ja ".to_owned();
        config.hotkeys.screenshot = " CmdOrCtrl+Shift+T ".to_owned();
        config.hotkeys.selection = " Alt+F8 ".to_owned();
        config.translator.openai_compatible.api_key = Some(" sk-test ".to_owned());
        config.translator.openai_compatible.model = " gpt-test ".to_owned();
        config.translator.deepl.api_key = Some("   ".to_owned());
        config.ocr.model_dir = ModelDir::Custom(std::path::PathBuf::from(" ./models "));
        let state = AppState::with_config_path(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
            Some(config_path.clone()),
        )
        .expect("app state");

        let updated = update_config_inner(&state, config).expect("updated config");
        let loaded = AppConfig::load_or_default(Some(config_path)).expect("loaded config");

        assert_eq!(updated.target_lang.0, "ja");
        assert_eq!(updated.hotkeys.selection, "Alt+F8");
        assert_eq!(
            updated.translator.openai_compatible.api_key.as_deref(),
            Some("sk-test")
        );
        assert_eq!(updated.translator.openai_compatible.model, "gpt-test");
        assert_eq!(updated.translator.deepl.api_key, None);
        assert_eq!(
            updated.ocr.model_dir,
            ModelDir::Custom(std::path::PathBuf::from("./models"))
        );
        assert_eq!(loaded, updated);
        assert_eq!(get_config_inner(&state).expect("state config"), updated);
    }

    #[test]
    fn update_config_rejects_duplicate_hotkeys_without_replacing_state() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let config_path = tempdir.path().join("config.yaml");
        let original = AppConfig::default();
        let mut invalid = original.clone();
        invalid.hotkeys.selection = invalid.hotkeys.screenshot.clone();
        let state = AppState::with_config_path(
            original.clone(),
            HistoryStore::in_memory().expect("history store"),
            Some(config_path.clone()),
        )
        .expect("app state");

        let err = update_config_inner(&state, invalid).expect_err("duplicate hotkeys");

        assert!(
            err.to_string()
                .contains("screenshot and selection hotkeys must be different")
        );
        assert_eq!(get_config_inner(&state).expect("state config"), original);
        assert!(!config_path.exists());
    }

    #[test]
    fn bundled_model_dir_defaults_to_development_models_path() {
        let config = AppConfig::default();

        assert_eq!(
            resolve_model_dir(&config, None),
            std::path::Path::new("models")
        );
    }

    #[test]
    fn bundled_model_dir_uses_packaged_resource_dir_when_available() {
        let config = AppConfig::default();
        let resource_dir = std::path::Path::new("/tmp/snaptext-resources");

        assert_eq!(
            resolve_model_dir(&config, Some(resource_dir)),
            resource_dir.join("models")
        );
    }

    #[test]
    fn validate_ocr_models_reports_missing_files() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let status = validate_ocr_models_inner(&state).expect("model status");

        assert!(!status.valid);
        assert!(status.missing_files.contains(&"det.onnx".to_owned()));
        assert!(status.missing_files.contains(&"cls.onnx".to_owned()));
        assert!(status.missing_files.contains(&"rec.onnx".to_owned()));
        assert!(status.missing_files.contains(&"rec_dict.txt".to_owned()));
        assert_eq!(status.recognition_dict_len, 0);
        assert!(!status.loadable);
        assert!(status.message.contains("missing required files"));
    }

    #[test]
    fn validate_ocr_models_reports_unloadable_onnx_files() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        std::fs::write(tempdir.path().join("det.onnx"), b"det").expect("det");
        std::fs::write(tempdir.path().join("cls.onnx"), b"cls").expect("cls");
        std::fs::write(tempdir.path().join("rec.onnx"), b"rec").expect("rec");
        std::fs::write(tempdir.path().join("rec_dict.txt"), "a\n").expect("dict");

        let mut config = AppConfig::default();
        config.ocr.model_dir = ModelDir::Custom(tempdir.path().to_path_buf());
        let state = AppState::new(config, HistoryStore::in_memory().expect("history store"))
            .expect("app state");

        let status = validate_ocr_models_inner(&state).expect("model status");

        assert!(!status.valid);
        assert!(status.missing_files.is_empty());
        assert_eq!(status.recognition_dict_len, 1);
        assert!(!status.loadable);
        assert!(status.message.contains("ONNX sessions failed to load"));
    }

    #[test]
    fn desktop_capabilities_include_required_plan_features() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");
        let capabilities = desktop_capabilities(&state);
        let names = capabilities
            .iter()
            .map(|capability| capability.capability.as_str())
            .collect::<Vec<_>>();

        assert!(names.contains(&"screenshot"));
        assert!(names.contains(&"selection"));
        assert!(names.contains(&"global_hotkey"));
        assert!(names.contains(&"ocr_worker"));
        assert!(
            !capabilities
                .iter()
                .find(|capability| capability.capability == "ocr_worker")
                .expect("ocr worker capability")
                .status
                .trim()
                .is_empty()
        );
        assert!(
            capabilities
                .iter()
                .all(|capability| !capability.action.is_empty())
        );
    }

    #[test]
    fn check_ocr_worker_accepts_fake_worker_mode() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");
        let worker = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(OCR_WORKER_PATH);
        unsafe {
            std::env::set_var("SNAPTEXT_OCR_FAKE_OUTPUT", r#"{"text":"hello"}"#);
            std::env::set_var("SNAPTEXT_OCR_WORKER", worker);
        }

        let status = check_ocr_worker_inner(&state);

        unsafe {
            std::env::remove_var("SNAPTEXT_OCR_FAKE_OUTPUT");
            std::env::remove_var("SNAPTEXT_OCR_WORKER");
        }
        assert!(status.python_available);
        assert!(status.paddleocr_available);
        assert!(status.worker_ready);
    }

    #[tokio::test]
    async fn translate_image_base64_rejects_invalid_image_data() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err = translate_image_base64_inner(&state, "not-image".to_owned())
            .await
            .expect_err("invalid image");

        assert!(err.to_string().contains("image failed"));
    }

    #[tokio::test]
    async fn translate_screenshot_region_rejects_empty_region_before_ocr() {
        let state = AppState::new(
            AppConfig::default(),
            HistoryStore::in_memory().expect("history store"),
        )
        .expect("app state");

        let err = translate_screenshot_region_inner(
            &state,
            snaptext_core::ocr::BBox {
                x: 0,
                y: 0,
                width: 0,
                height: 10,
            },
        )
        .await
        .expect_err("empty region");

        assert!(err.to_string().contains("capture region cannot be empty"));
    }

    #[test]
    fn tray_action_ids_map_to_expected_actions() {
        assert_eq!(tray_action_for_id(TRAY_SHOW), Some(TrayAction::Show));
        assert_eq!(tray_action_for_id(TRAY_HIDE), Some(TrayAction::Hide));
        assert_eq!(tray_action_for_id(TRAY_QUIT), Some(TrayAction::Quit));
        assert_eq!(tray_action_for_id("unknown"), None);
    }

    #[test]
    fn parse_history_source_maps_supported_values() {
        assert_eq!(
            parse_history_source("text").expect("text source"),
            HistorySource::Text
        );
        assert_eq!(
            parse_history_source("selection").expect("selection source"),
            HistorySource::Selection
        );
        assert_eq!(
            parse_history_source("screenshot").expect("screenshot source"),
            HistorySource::Screenshot
        );
        assert_eq!(
            parse_history_source("image").expect("image source"),
            HistorySource::Image
        );
    }

    #[test]
    fn parse_history_source_trims_command_boundary_input() {
        assert_eq!(
            parse_history_source(" \nselection\t").expect("selection source"),
            HistorySource::Selection
        );
    }

    #[test]
    fn parse_history_source_rejects_unknown_value() {
        let err = parse_history_source("unknown").expect_err("unsupported source");

        assert!(err.to_string().contains("unsupported history source"));
    }

    #[test]
    fn history_record_to_translation_result_preserves_snapshot_fields() {
        let record = HistoryRecord {
            id: 42,
            created_at: 1_789_000_000,
            source: HistorySource::Screenshot,
            source_text: String::from("hello\nworld"),
            target_lang: String::from("ja"),
            translated_text: String::from("konnichiwa\nsekai"),
        };

        let result = history_record_to_translation_result(&record);

        assert_eq!(result.source, HistorySource::Screenshot);
        assert_eq!(result.source_text, "hello\nworld");
        assert_eq!(result.target_lang, "ja");
        assert_eq!(result.translated_text, "konnichiwa\nsekai");
        assert!(result.text_lines.is_empty());
    }

    #[test]
    fn overlay_translation_payload_preserves_result_and_region() {
        let result = TranslationResult {
            source: HistorySource::Screenshot,
            source_text: String::from("hello"),
            translated_text: String::from("bonjour"),
            target_lang: String::from("fr"),
            text_lines: Vec::new(),
        };
        let region = snaptext_core::ocr::BBox {
            x: 10,
            y: 20,
            width: 200,
            height: 80,
        };

        let payload = OverlayTranslationPayload {
            result: result.clone(),
            region,
        };

        assert_eq!(payload.result, result);
        assert_eq!(payload.region, region);
    }

    #[test]
    fn result_window_state_targets_include_main_window_only() {
        assert_eq!(result_window_state_targets(), [MAIN_WINDOW_LABEL]);
    }

    #[test]
    fn screenshot_payload_encodes_png_metadata() {
        let image = RgbaImage::new(2, 3);

        let payload = ScreenshotPayload::from_image(image).expect("screenshot payload");

        assert_eq!(payload.meta.width, 2);
        assert_eq!(payload.meta.height, 3);
        assert!(!payload.base64_png.is_empty());
    }

    #[test]
    fn image_payload_base64_segment_accepts_raw_or_data_url_payloads() {
        assert_eq!(
            image_payload_base64_segment("  aGVsbG8=  ").expect("raw payload"),
            "aGVsbG8="
        );
        assert_eq!(
            image_payload_base64_segment("data:image/png;base64, aGVsbG8= ").expect("data URL"),
            "aGVsbG8="
        );
        assert_eq!(
            image_payload_base64_segment("data:image/jpeg;charset=utf-8;base64, aGVsbG8= ")
                .expect("jpeg data URL"),
            "aGVsbG8="
        );
        assert_eq!(
            image_payload_base64_segment("data:image/webp;BASE64,aGVsbG8=").expect("webp data URL"),
            "aGVsbG8="
        );
    }

    #[test]
    fn image_payload_base64_segment_rejects_invalid_data_urls() {
        let missing_payload =
            image_payload_base64_segment("data:image/png;base64").expect_err("missing payload");
        let not_base64 =
            image_payload_base64_segment("data:image/png,abc").expect_err("missing base64 marker");
        let unsupported_media_type = image_payload_base64_segment("data:text/plain;base64,abc")
            .expect_err("unsupported media type");
        let missing_media_type =
            image_payload_base64_segment("data:;base64,abc").expect_err("missing media type");

        assert!(
            missing_payload
                .to_string()
                .contains("image data URL is missing base64 payload")
        );
        assert!(
            not_base64
                .to_string()
                .contains("image data URL must be base64 encoded")
        );
        assert!(
            unsupported_media_type
                .to_string()
                .contains("media type `text/plain` is not supported")
        );
        assert!(
            missing_media_type
                .to_string()
                .contains("media type `` is not supported")
        );
    }

    #[test]
    fn base64_image_loader_accepts_plan_image_formats() {
        for format in [ImageFormat::Png, ImageFormat::Jpeg, ImageFormat::WebP] {
            let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
                3,
                2,
                image::Rgba([10, 20, 30, 255]),
            ));
            let mut bytes = Vec::new();
            image
                .write_to(&mut Cursor::new(&mut bytes), format)
                .expect("encode image");
            let payload = STANDARD.encode(bytes);

            let decoded = base64_image_to_dynamic_image(&payload).expect("decode image");

            assert_eq!(decoded.width(), 3);
            assert_eq!(decoded.height(), 2);
        }
    }

    #[test]
    fn base64_image_loader_rejects_non_plan_image_formats() {
        let payload = STANDARD.encode(b"GIF89a\x01\x00\x01\x00\x00\x00\x00");

        let err = base64_image_to_dynamic_image(&payload).expect_err("unsupported image format");

        assert!(err.to_string().contains("unsupported image format"));
        assert!(err.to_string().contains("PNG, JPEG, or WebP"));
    }

    #[test]
    fn base64_image_loader_accepts_data_url_payload() {
        let image =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(3, 2, image::Rgba([10, 20, 30, 255])));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .expect("encode image");
        let payload = format!("data:image/png;base64,{}", STANDARD.encode(bytes));

        let decoded = base64_image_to_dynamic_image(&payload).expect("decode data URL image");

        assert_eq!(decoded.width(), 3);
        assert_eq!(decoded.height(), 2);
    }

    #[test]
    fn base64_image_loader_rejects_empty_payload() {
        let err = base64_image_to_dynamic_image("   ").expect_err("empty payload");

        assert!(err.to_string().contains("image payload cannot be empty"));
    }

    #[test]
    fn base64_image_loader_rejects_oversized_payload_bytes() {
        let payload = "A".repeat(max_base64_payload_chars() + 1);

        let err = base64_image_to_dynamic_image(&payload).expect_err("oversized payload");

        assert!(err.to_string().contains("image payload is too large"));
    }

    #[test]
    fn decoded_image_dimension_validation_rejects_oversized_images() {
        let image = DynamicImage::new_rgba8(6000, 5000);

        let err = validate_decoded_image_dimensions(&image).expect_err("oversized image");

        assert!(err.to_string().contains("image is too large"));
        assert!(err.to_string().contains("6000x5000"));
    }

    #[test]
    fn crop_image_rejects_empty_or_out_of_bounds_regions() {
        let image = DynamicImage::ImageRgba8(RgbaImage::new(10, 10));

        let empty = crop_image(
            &image,
            snaptext_core::ocr::BBox {
                x: 0,
                y: 0,
                width: 0,
                height: 1,
            },
        )
        .expect_err("empty region");
        assert!(empty.to_string().contains("capture region cannot be empty"));

        let outside = crop_image(
            &image,
            snaptext_core::ocr::BBox {
                x: 20,
                y: 0,
                width: 1,
                height: 1,
            },
        )
        .expect_err("outside region");
        assert!(outside.to_string().contains("outside the screenshot"));
    }

    #[test]
    fn project_ocr_python_discovery_walks_up_from_nested_directories() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let nested = tempdir.path().join("crates/snaptext-tauri");
        let python = tempdir.path().join(OCR_VENV_PYTHON);
        std::fs::create_dir_all(python.parent().expect("python parent")).expect("venv dir");
        std::fs::create_dir_all(&nested).expect("nested dir");
        std::fs::write(&python, "#!/usr/bin/env python\n").expect("python marker");

        assert_eq!(find_ocr_venv_python_from(&nested), Some(python));
    }

    #[test]
    fn ocr_worker_error_message_prefers_json_error_and_strips_ansi() {
        let stderr = "\u{1b}[32mCreating model\u{1b}[0m {\"error\":\"missing paddle\"}";

        assert_eq!(ocr_worker_error_message(stderr, ""), "missing paddle");
        assert_eq!(
            ocr_worker_error_message("\u{1b}[32mplain failure\u{1b}[0m", ""),
            "plain failure"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_screenshot_selection_error_includes_status_or_stderr() {
        assert_eq!(
            mac_screenshot_selection_error(Some(1), b""),
            "screenshot selection produced no image; status=1"
        );
        assert_eq!(
            mac_screenshot_selection_error(Some(1), b"permission denied\n"),
            "screenshot selection failed: permission denied"
        );
    }
}
