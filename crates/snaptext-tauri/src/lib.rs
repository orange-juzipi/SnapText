use image::DynamicImage;
#[cfg(not(test))]
use snaptext_core::selection::ensure_selection_permission;
use snaptext_core::{
    Error, Result,
    config::{AppConfig, Lang},
    history::{HistoryRecord, HistorySource, HistoryStore, NewHistoryRecord},
    ocr::OcrEngine,
    pipeline::{TranslationResult, first_translated_text},
    selection::{SelectionEvent, looks_like_garbled_selection, normalize_selection_text},
    translate::{DictionaryEntry, TranslateRequest, TranslatorRegistry, resolve_auto_target_lang},
};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::time::Duration;
use tauri::Manager;
use tauri::{AppHandle, Emitter, State};
#[cfg(not(test))]
use tauri_plugin_global_shortcut::ShortcutState;

mod events;
#[cfg(not(test))]
mod hotkeys;
mod model;
mod payload;
mod screenshots;
mod state;
mod tray;
mod voice_input;
mod window;
use events::{
    OverlayTranslationPayload, PinnedResultPayload, SelectionTextPayload, emit_overlay_ocr,
    emit_result_translation, emit_result_window_state, emit_selection_record,
    history_record_to_translation_result, overlay_translation_event, parse_history_source,
    remember_result_snapshot,
};
#[cfg(target_os = "macos")]
use events::{emit_overlay_ocr_failed, emit_overlay_ocr_started};
#[cfg(not(test))]
use events::{emit_selection_failure, emit_selection_text};
#[cfg(test)]
use events::{result_window_state_targets, selection_failure_message};
#[cfg(not(test))]
use hotkeys::{
    configured_hotkey_routes, configured_hotkeys, handle_global_hotkey, hotkey_action_for_event_id,
    refresh_global_hotkeys,
};
use model::resolve_model_dir;
pub use payload::ScreenshotPayload;
use payload::{
    ImagePreprocessOptions, base64_image_to_dynamic_image, crop_image, png_payload_to_image,
    preprocess_image, validate_decoded_image_dimensions,
};
#[cfg(all(test, target_os = "macos"))]
use screenshots::mac_screenshot_selection_error;
#[cfg(target_os = "macos")]
use screenshots::{capture_macos_interactive_screenshot, payload_to_full_region};
use screenshots::{screenshot_full_inner, screenshot_region_inner};
use state::AppState;
#[cfg(not(target_os = "macos"))]
use state::OverlaySession;
#[cfg(not(test))]
use tray::setup_tray;
#[cfg(not(test))]
use window::setup_main_window_close_behavior;
#[cfg(not(test))]
use window::show_main_window;
#[cfg(not(target_os = "macos"))]
use window::show_overlay_window;
use window::{
    hide_main_window, hide_overlay_window, hide_result_window, main_window_is_visible,
    restore_main_window_if_needed, show_result_window,
};

const MAIN_WINDOW_LABEL: &str = "main";
/// Label used by the independent result WebViewWindow.
pub(crate) const RESULT_WINDOW_LABEL: &str = "result";
#[cfg(not(target_os = "macos"))]
const OVERLAY_WINDOW_LABEL: &str = "overlay";
const MAIN_WINDOW_HIDE_SETTLE_MS: u64 = 160;
#[cfg(all(debug_assertions, not(test)))]
const SNAPTEXT_CLOUD_ENV_VAR: &str = "SNAPTEXT_CLOUD_ENV";
#[cfg(all(debug_assertions, not(test)))]
const SNAPTEXT_CLOUD_LOCAL_ENDPOINT: &str = "http://127.0.0.1:8080";

pub(crate) fn translator_registry_for_config(config: &AppConfig) -> Result<TranslatorRegistry> {
    let mut translator = config.translator.clone();
    apply_snaptext_cloud_runtime_override(&mut translator)?;
    Ok(TranslatorRegistry::new(translator))
}

#[cfg(all(debug_assertions, not(test)))]
fn apply_snaptext_cloud_runtime_override(
    translator: &mut snaptext_core::config::TranslatorConfig,
) -> Result<()> {
    let Ok(value) = std::env::var(SNAPTEXT_CLOUD_ENV_VAR) else {
        return Ok(());
    };
    let env = value.trim();
    if env.is_empty() || env.eq_ignore_ascii_case("production") || env.eq_ignore_ascii_case("prod")
    {
        return Ok(());
    }
    if !env.eq_ignore_ascii_case("local") {
        return Err(Error::Config(format!(
            "{SNAPTEXT_CLOUD_ENV_VAR} must be local or production"
        )));
    }

    // 仅在开发运行时覆盖 translator，不写入配置文件，也不暴露到设置页。
    translator.snaptext_cloud.endpoint = SNAPTEXT_CLOUD_LOCAL_ENDPOINT
        .parse()
        .map_err(|err| Error::Config(format!("invalid local SnapText Cloud endpoint: {err}")))?;
    tracing::warn!(
        endpoint = SNAPTEXT_CLOUD_LOCAL_ENDPOINT,
        "using local SnapText Cloud runtime override"
    );
    Ok(())
}

#[cfg(not(all(debug_assertions, not(test))))]
fn apply_snaptext_cloud_runtime_override(
    _translator: &mut snaptext_core::config::TranslatorConfig,
) -> Result<()> {
    Ok(())
}

#[cfg(not(test))]
pub fn run_tauri(config: AppConfig, history: HistoryStore) -> Result<()> {
    let hotkeys = configured_hotkeys(&config);
    let hotkey_routes = configured_hotkey_routes(&config)?;

    let app = tauri::Builder::default()
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
            search_history,
            delete_history,
            clear_history,
            get_config,
            get_result_snapshot,
            get_overlay_screenshot,
            clear_overlay_screenshot,
            screenshot_full,
            screenshot_region,
            start_screenshot_overlay,
            update_config,
            open_system_settings,
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
            voice_input_supported,
            start_voice_input,
            stop_voice_input,
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
            setup_main_window_close_behavior(app.handle())?;

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
        .build(tauri::generate_context!())
        .map_err(|err| snaptext_core::Error::Config(err.to_string()))?;

    app.run(handle_run_event);
    Ok(())
}

#[cfg(test)]
fn refresh_global_hotkeys(_app: &AppHandle, _config: &AppConfig) -> Result<()> {
    Ok(())
}

#[cfg(all(not(test), target_os = "macos"))]
fn handle_run_event(app: &AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Reopen {
        has_visible_windows: false,
        ..
    } = event
    {
        // macOS sends this when the user clicks the Dock icon while the app is
        // still running but has no visible windows.
        if let Err(err) = show_main_window(app) {
            tracing::warn!(error = %err, "failed to show main window on app reopen");
        }
    }
}

#[cfg(all(not(test), not(target_os = "macos")))]
fn handle_run_event(_app: &AppHandle, _event: tauri::RunEvent) {}

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

/// Searches local history by source/translation text and optional source kind.
#[tauri::command]
#[allow(dead_code)]
fn search_history(
    state: State<'_, AppState>,
    query: Option<String>,
    source: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    limit: Option<usize>,
) -> Result<Vec<HistoryRecord>> {
    let source = source.as_deref().map(parse_history_source).transpose()?;
    let history = state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?;
    history.search_with_dates(
        query.as_deref(),
        source.as_ref(),
        from,
        to,
        limit.unwrap_or(50),
    )
}

/// Deletes one local history record without touching other records.
#[tauri::command]
#[allow(dead_code)]
fn delete_history(state: State<'_, AppState>, id: i64) -> Result<()> {
    let history = state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?;
    history.delete(id)
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

#[derive(Debug, serde::Serialize)]
struct VoiceInputResult {
    text: String,
}

#[tauri::command]
#[allow(dead_code)]
fn voice_input_supported() -> bool {
    cfg!(target_os = "macos")
}

#[tauri::command]
#[allow(dead_code)]
fn start_voice_input(app: AppHandle, state: State<'_, AppState>, locale: String) -> Result<()> {
    voice_input::start_voice_input(state.inner(), app, locale)
}

#[tauri::command]
#[allow(dead_code)]
async fn stop_voice_input(state: State<'_, AppState>) -> Result<VoiceInputResult> {
    let text = voice_input::stop_voice_input(state.inner()).await?;
    Ok(VoiceInputResult { text })
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

/// Opens the requested macOS privacy pane without attempting to infer its grant state.
#[tauri::command]
#[allow(dead_code)]
fn open_system_settings(section: String) -> Result<()> {
    open_system_settings_inner(&section)
}

#[cfg(target_os = "macos")]
/// Opens a supported macOS privacy pane using the system `open` command.
fn open_system_settings_inner(section: &str) -> Result<()> {
    let pane = match section {
        "screen_recording" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        _ => {
            return Err(Error::Config(
                "unsupported system settings section".to_owned(),
            ));
        }
    };
    Command::new("open")
        .arg(pane)
        .status()
        .map_err(|err| Error::Config(format!("failed to open system settings: {err}")))?
        .success()
        .then_some(())
        .ok_or_else(|| Error::Config("system settings could not be opened".to_owned()))
}

#[cfg(not(target_os = "macos"))]
/// Reports that privacy-pane deep links are unavailable on non-macOS platforms.
fn open_system_settings_inner(_section: &str) -> Result<()> {
    Err(Error::Config(
        "system settings links are only available on macOS".to_owned(),
    ))
}

/// Returns the latest translation so a newly opened result window can hydrate immediately.
#[tauri::command]
#[allow(dead_code)]
fn get_result_snapshot(state: State<'_, AppState>) -> Result<Option<PinnedResultPayload>> {
    state
        .result_snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .map_err(|err| Error::Config(err.to_string()))
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
    start_screenshot_overlay_with_restore(app, state, false).await
}

#[cfg(not(test))]
pub(crate) async fn start_screenshot_overlay_from_hotkey_inner(
    app: &AppHandle,
    state: &AppState,
) -> Result<ScreenshotPayload> {
    start_screenshot_overlay_with_restore(app, state, true).await
}

async fn start_screenshot_overlay_with_restore(
    app: &AppHandle,
    state: &AppState,
    force_restore_main_window: bool,
) -> Result<ScreenshotPayload> {
    #[cfg(target_os = "macos")]
    {
        return start_native_screenshot_selection_inner(app, state, force_restore_main_window)
            .await;
    }

    #[cfg(not(target_os = "macos"))]
    {
        start_webview_screenshot_overlay_inner(app, state, force_restore_main_window).await
    }
}

#[cfg(target_os = "macos")]
async fn start_native_screenshot_selection_inner(
    app: &AppHandle,
    state: &AppState,
    force_restore_main_window: bool,
) -> Result<ScreenshotPayload> {
    let restore_main_window = force_restore_main_window || main_window_is_visible(app);
    hide_overlay_window(app)?;
    hide_main_window(app)?;
    tokio::time::sleep(Duration::from_millis(MAIN_WINDOW_HIDE_SETTLE_MS)).await;

    let capture = capture_macos_interactive_screenshot();
    restore_main_window_if_needed(app, restore_main_window)?;

    let (payload, image) = capture?;
    emit_overlay_ocr_started(app, payload_to_full_region(&payload));
    match ocr_dynamic_image_inner(state, image).await {
        Ok(result) => {
            let translate_after_ocr = state
                .config
                .read()
                .map(|config| config.ui.auto_translate)
                .unwrap_or(true);
            emit_overlay_ocr(
                app,
                result,
                payload_to_full_region(&payload),
                translate_after_ocr,
            )
        }
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
    force_restore_main_window: bool,
) -> Result<ScreenshotPayload> {
    let restore_main_window = force_restore_main_window || main_window_is_visible(app);
    hide_main_window(app)?;
    // 等待主窗口从合成器里消失，避免 overlay 背景截图把 SnapText 自己截进去。
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
    // The overlay WebView is reused after being hidden, so explicitly replace its previous image.
    emit_overlay_screenshot(app, &payload);
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
/// Translates selected text and stores it for the independent result window.
async fn translate_selection(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<HistoryRecord> {
    let record = translate_selection_inner(state.inner(), text).await?;
    // Direct selection commands do not emit an event, so keep the result window snapshot current.
    remember_result_snapshot(&app, PinnedResultPayload::from(&record));
    Ok(record)
}

#[tauri::command]
#[allow(dead_code)]
async fn translate_text(
    app: AppHandle,
    state: State<'_, AppState>,
    source_text: String,
    target_lang: Option<String>,
    source_lang: Option<String>,
) -> Result<HistoryRecord> {
    let record = translate_text_inner(state.inner(), source_text, target_lang, source_lang).await?;
    // Text commands do not necessarily emit a result event, so persist the snapshot here too.
    remember_result_snapshot(&app, PinnedResultPayload::from(&record));
    Ok(record)
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
    bbox: Option<snaptext_core::ocr::BBox>,
    preprocess_options: Option<ImagePreprocessOptions>,
) -> Result<TranslationResult> {
    let result = translate_base64_image_inner(
        state.inner(),
        base64_png,
        HistorySource::Image,
        bbox,
        preprocess_options,
    )
    .await?;
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
    preprocess_options: Option<ImagePreprocessOptions>,
) -> Result<OcrTextResult> {
    ocr_image_region_with_options_inner(state.inner(), base64_png, bbox, preprocess_options).await
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
    translate_after_ocr: Option<bool>,
) -> Result<OcrTextResult> {
    let restore_main_window = overlay_restore_main_window(state.inner())?;
    hide_overlay_window(&app)?;
    restore_main_window_if_needed(&app, restore_main_window)?;

    let result = ocr_overlay_selection_inner(state.inner(), bbox).await?;
    emit_overlay_ocr(
        &app,
        result.clone(),
        bbox,
        translate_after_ocr.unwrap_or(true),
    );
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
    if let Err(err) = app.emit_to(
        MAIN_WINDOW_LABEL,
        overlay_translation_event(),
        event.clone(),
    ) {
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
fn pin_result_window(app: AppHandle, snapshot: Option<PinnedResultPayload>) -> Result<()> {
    if let Some(snapshot) = snapshot {
        // The caller owns the current editing state; prefer it over a stale native snapshot.
        remember_result_snapshot(&app, snapshot);
    }
    let dock = app
        .try_state::<AppState>()
        .and_then(|state| {
            state
                .config
                .read()
                .ok()
                .map(|config| config.ui.result_panel_dock.clone())
        })
        .unwrap_or(snaptext_core::config::ResultPanelDock::Cursor);
    show_result_window(&app, dock)?;
    #[cfg(not(test))]
    if let Some(state) = app.try_state::<AppState>() {
        state
            .result_window_pinned
            .store(true, std::sync::atomic::Ordering::Release);
    }
    emit_result_window_state(&app, true)?;
    if let Some(snapshot) = app.try_state::<AppState>().and_then(|state| {
        state
            .result_snapshot
            .lock()
            .ok()
            .and_then(|snapshot| snapshot.clone())
    }) {
        remember_result_snapshot(&app, snapshot);
    }
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
fn unpin_result_window(app: AppHandle) -> Result<()> {
    #[cfg(not(test))]
    if let Some(state) = app.try_state::<AppState>() {
        state
            .result_window_pinned
            .store(false, std::sync::atomic::Ordering::Release);
    }
    hide_result_window(&app)?;
    emit_result_window_state(&app, false)?;
    Ok(())
}

async fn translate_text_inner(
    state: &AppState,
    text: String,
    target_lang: Option<String>,
    source_lang: Option<String>,
) -> Result<HistoryRecord> {
    translate_text_with_source_inner(state, text, HistorySource::Text, target_lang, source_lang)
        .await
}

async fn translate_selection_inner(state: &AppState, text: String) -> Result<HistoryRecord> {
    let text = normalize_selection_text_for_translation(text)?;

    translate_text_with_source_inner(state, text, HistorySource::Selection, None, None).await
}

async fn translate_text_with_source_inner(
    state: &AppState,
    text: String,
    source: HistorySource,
    target_lang: Option<String>,
    source_lang: Option<String>,
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
    let target_lang = resolve_auto_target_lang(&text, target_lang);
    ensure_supported_target_lang_for_translation(&target_lang)?;
    let source_lang = source_lang
        .map(|value| Lang(value.trim().to_owned()))
        .filter(|value| !value.0.is_empty() && value.0 != "auto");
    let request = TranslateRequest {
        texts: vec![text.clone()],
        source: source_lang,
        target: target_lang.clone(),
    };
    let translation = translate_first_for_history(state, translator, request).await?;

    let history = state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?;

    // Keep history writes behind the command boundary so every translated
    // text request has the same persistence behavior as screenshot and image flows.
    // 词典增强只附在本次返回 payload 上，历史表仍只保存稳定的译文文本。
    let mut record = history.insert(NewHistoryRecord {
        source,
        source_text: text.clone(),
        target_lang: target_lang.0,
        translated_text: translation.translated_text,
    })?;
    record.dictionary_entries = translation.dictionary_entries;
    Ok(record)
}

fn ensure_supported_target_lang_for_translation(target_lang: &Lang) -> Result<()> {
    if target_lang.0.trim().is_empty() {
        return Err(Error::Config("target language cannot be empty".to_owned()));
    }
    Ok(())
}

struct HistoryTranslation {
    translated_text: String,
    dictionary_entries: Vec<DictionaryEntry>,
}

async fn translate_first_for_history(
    _state: &AppState,
    translator: TranslatorRegistry,
    request: TranslateRequest,
) -> Result<HistoryTranslation> {
    #[cfg(test)]
    if let Some(translated_text) = take_fake_translated_text(_state) {
        snaptext_core::translate::validate_translate_request(&request)?;
        return Ok(HistoryTranslation {
            translated_text,
            dictionary_entries: Vec::new(),
        });
    }

    let translation = translator.translate(request).await?;
    let translated_text = first_translated_text(&translation.translated_texts)?;
    Ok(HistoryTranslation {
        translated_text,
        dictionary_entries: translation.dictionary_entries,
    })
}

fn normalize_selection_text_for_translation(text: String) -> Result<String> {
    let text = normalize_selection_text(text);
    if text.is_empty() {
        return Err(Error::Translate("selected text cannot be empty".to_owned()));
    }
    if looks_like_garbled_selection(&text) {
        return Err(Error::Selection(
            "selected text could not be decoded correctly".to_owned(),
        ));
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
    let target_lang = resolve_auto_target_lang(&source_text, target_lang);
    ensure_supported_target_lang_for_translation(&target_lang)?;
    let translation = translator
        .translate(TranslateRequest {
            texts: vec![source_text.clone()],
            source: None,
            target: target_lang.clone(),
        })
        .await?;
    let translated_text = first_translated_text(&translation.translated_texts)?;

    let mut record = state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?
        .insert(NewHistoryRecord {
            source,
            source_text,
            target_lang: target_lang.0,
            translated_text,
        })?;
    record.dictionary_entries = translation.dictionary_entries;
    Ok(record)
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

/// Keeps the original image translation helper available to callers without crop options.
#[allow(dead_code)]
async fn translate_image_base64_inner(
    state: &AppState,
    base64_png: String,
) -> Result<TranslationResult> {
    translate_base64_image_inner(state, base64_png, HistorySource::Image, None, None).await
}

async fn translate_screenshot_base64_inner(
    state: &AppState,
    base64_png: String,
) -> Result<TranslationResult> {
    translate_base64_image_inner(state, base64_png, HistorySource::Screenshot, None, None).await
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
    ocr_dynamic_image_inner(state, cropped).await
}

/// Keeps the original image OCR helper available for native unit tests and callers without options.
#[allow(dead_code)]
async fn ocr_image_region_inner(
    state: &AppState,
    base64_png: String,
    bbox: snaptext_core::ocr::BBox,
) -> Result<OcrTextResult> {
    ocr_image_region_with_options_inner(state, base64_png, bbox, None).await
}

/// Runs OCR on an imported image region after applying an optional preprocessing profile.
async fn ocr_image_region_with_options_inner(
    state: &AppState,
    base64_png: String,
    bbox: snaptext_core::ocr::BBox,
    preprocess_options: Option<ImagePreprocessOptions>,
) -> Result<OcrTextResult> {
    let image = base64_image_to_dynamic_image(&base64_png)?;
    let cropped = crop_image(&image, bbox)?;
    let processed = preprocess_image(cropped, preprocess_options.as_ref())?;
    ocr_dynamic_image_inner(state, processed).await
}

async fn ocr_screenshot_region_inner(
    state: &AppState,
    bbox: snaptext_core::ocr::BBox,
) -> Result<OcrTextResult> {
    let image = state.screencap.capture_region(bbox).await?;
    ocr_dynamic_image_inner(state, DynamicImage::ImageRgba8(image)).await
}

async fn translate_base64_image_inner(
    state: &AppState,
    base64_png: String,
    source: HistorySource,
    bbox: Option<snaptext_core::ocr::BBox>,
    preprocess_options: Option<ImagePreprocessOptions>,
) -> Result<TranslationResult> {
    let image = base64_image_to_dynamic_image(&base64_png)?;
    let image = if let Some(bbox) = bbox {
        crop_image(&image, bbox)?
    } else {
        image
    };
    let image = preprocess_image(image, preprocess_options.as_ref())?;
    translate_dynamic_image_inner(state, image, source).await
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

    let ocr_result = ocr_dynamic_image_inner(state, image).await?;
    let target = resolve_auto_target_lang(&ocr_result.source_text, target);
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
        dictionary_entries: translation.dictionary_entries,
    };
    let history_record = result.clone().into_history_record();
    state
        .history
        .lock()
        .map_err(|err| Error::History(err.to_string()))?
        .insert(history_record)?;

    Ok(result)
}

async fn ocr_dynamic_image_inner(state: &AppState, image: DynamicImage) -> Result<OcrTextResult> {
    validate_decoded_image_dimensions(&image)?;
    let ocr = state
        .ocr
        .read()
        .map_err(|err| Error::Ocr(err.to_string()))?
        .clone();
    let text_lines = ocr.run(image).await?;
    let source_text = snaptext_core::ocr::aggregate_text(&text_lines);
    if source_text.trim().is_empty() {
        return Err(Error::Ocr(
            "OCR did not detect any translatable text".to_owned(),
        ));
    }

    Ok(OcrTextResult {
        source_text,
        text_lines,
    })
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct OcrTextResult {
    pub source_text: String,
    pub text_lines: Vec<snaptext_core::ocr::TextLine>,
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
        *translator = translator_registry_for_config(&config)?;
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

#[cfg(test)]
mod tests;
