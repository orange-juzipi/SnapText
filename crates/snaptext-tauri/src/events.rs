use snaptext_core::{
    Error, Result, history::HistoryRecord, pipeline::TranslationResult, translate::DictionaryEntry,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::{HistorySource, MAIN_WINDOW_LABEL, OcrTextResult};
#[cfg(not(target_os = "macos"))]
use crate::{OVERLAY_WINDOW_LABEL, ScreenshotPayload};

const RESULT_TRANSLATION_EVENT: &str = "snaptext://result-translation";
const RESULT_SELECTION_EVENT: &str = "snaptext://result-selection";
pub(crate) const RESULT_SNAPSHOT_EVENT: &str = "snaptext://result-snapshot";
#[cfg(not(test))]
const SELECTION_TEXT_EVENT: &str = "snaptext://selection-text";
#[cfg(not(test))]
const RESULT_SELECTION_FAILED_EVENT: &str = "snaptext://result-selection-failed";
const RESULT_WINDOW_STATE_EVENT: &str = "snaptext://result-window-state";
const OVERLAY_TRANSLATION_EVENT: &str = "snaptext://overlay-translation";
#[cfg(not(target_os = "macos"))]
const OVERLAY_SCREENSHOT_EVENT: &str = "snaptext://overlay-screenshot";
#[cfg(target_os = "macos")]
const OVERLAY_OCR_STARTED_EVENT: &str = "snaptext://overlay-ocr-started";
#[cfg(target_os = "macos")]
const OVERLAY_OCR_FAILED_EVENT: &str = "snaptext://overlay-ocr-failed";
const OVERLAY_OCR_EVENT: &str = "snaptext://overlay-ocr";
#[cfg(target_os = "macos")]
pub(crate) const VOICE_INPUT_PARTIAL_EVENT: &str = "snaptext://voice-input-partial";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct OverlayTranslationPayload {
    pub result: TranslationResult,
    pub region: snaptext_core::ocr::BBox,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct OverlayOcrPayload {
    /// OCR output for the selected screen region.
    pub result: OcrTextResult,
    /// Whether the UI should start translation after showing the OCR text.
    pub translate_after_ocr: bool,
    /// Selected screen region in physical pixels.
    pub region: snaptext_core::ocr::BBox,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[allow(dead_code)]
pub struct SelectionFailurePayload {
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SelectionTextPayload {
    pub text: String,
    pub app_bundle_id: Option<String>,
}

/// Carries the latest translated result to the independent result window.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct PinnedResultPayload {
    /// Identifies whether the result came from text, a selection, a screenshot, or an image.
    pub source: HistorySource,
    /// The recognized or typed source text.
    pub source_text: String,
    /// The translated output shown to the user.
    pub translated_text: String,
    /// The language used for the translated output.
    pub target_lang: String,
    /// Optional dictionary entries associated with the translation.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dictionary_entries: Vec<DictionaryEntry>,
}

impl From<&TranslationResult> for PinnedResultPayload {
    fn from(result: &TranslationResult) -> Self {
        Self {
            source: result.source.clone(),
            source_text: result.source_text.clone(),
            translated_text: result.translated_text.clone(),
            target_lang: result.target_lang.clone(),
            dictionary_entries: result.dictionary_entries.clone(),
        }
    }
}

impl From<&HistoryRecord> for PinnedResultPayload {
    fn from(record: &HistoryRecord) -> Self {
        Self {
            source: record.source.clone(),
            source_text: record.source_text.clone(),
            translated_text: record.translated_text.clone(),
            target_lang: record.target_lang.clone(),
            dictionary_entries: record.dictionary_entries.clone(),
        }
    }
}

// 语音输入依赖 macOS Speech 框架，非 macOS 平台不保留该事件 payload，避免 clippy dead_code。
#[cfg(target_os = "macos")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct VoiceInputPartialPayload {
    pub text: String,
    pub final_result: bool,
}

pub(crate) fn overlay_translation_event() -> &'static str {
    OVERLAY_TRANSLATION_EVENT
}

/// Replaces the screenshot shown by a reused Windows/Linux overlay window.
#[cfg(not(target_os = "macos"))]
pub(crate) fn emit_overlay_screenshot(app: &AppHandle, payload: &ScreenshotPayload) {
    if let Err(err) = app.emit_to(
        OVERLAY_WINDOW_LABEL,
        OVERLAY_SCREENSHOT_EVENT,
        payload.clone(),
    ) {
        tracing::warn!(error = %err, "failed to refresh overlay screenshot");
    }
}

pub(crate) fn emit_result_window_state(app: &AppHandle, pinned: bool) -> Result<()> {
    for target in result_window_state_targets() {
        app.emit_to(target, RESULT_WINDOW_STATE_EVENT, pinned)
            .map_err(|err| Error::Config(err.to_string()))?;
    }
    Ok(())
}

pub(crate) fn result_window_state_targets() -> [&'static str; 1] {
    [MAIN_WINDOW_LABEL]
}

pub(crate) fn emit_result_translation(app: &AppHandle, result: &TranslationResult) {
    remember_result_snapshot(app, PinnedResultPayload::from(result));
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, RESULT_TRANSLATION_EVENT, result.clone()) {
        tracing::warn!(error = %err, "failed to emit result translation to main window");
    }
    emit_to_result_window(app, RESULT_TRANSLATION_EVENT, result);
}

pub(crate) fn emit_selection_record(app: &AppHandle, record: &HistoryRecord) {
    remember_result_snapshot(app, PinnedResultPayload::from(record));
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, RESULT_SELECTION_EVENT, record.clone()) {
        tracing::warn!(error = %err, "failed to emit selection result to main window");
    }
    emit_to_result_window(app, RESULT_SELECTION_EVENT, record);
}

/// Stores a result for the next result-window open and notifies an already-open window.
pub(crate) fn remember_result_snapshot(app: &AppHandle, payload: PinnedResultPayload) {
    if let Some(state) = app.try_state::<crate::AppState>() {
        match state.result_snapshot.lock() {
            Ok(mut snapshot) => *snapshot = Some(payload.clone()),
            Err(err) => tracing::warn!(error = %err, "failed to store result window snapshot"),
        }
    }
    emit_to_result_window(app, RESULT_SNAPSHOT_EVENT, &payload);
}

/// Sends an event only when the independent result window has already been created.
fn emit_to_result_window<S: serde::Serialize>(app: &AppHandle, event: &str, payload: &S) {
    if app.get_webview_window(crate::RESULT_WINDOW_LABEL).is_none() {
        return;
    }
    if let Err(err) = app.emit_to(crate::RESULT_WINDOW_LABEL, event, payload) {
        tracing::warn!(error = %err, event, "failed to emit result event to independent window");
    }
}

#[cfg(not(test))]
pub(crate) fn emit_selection_text(app: &AppHandle, payload: &SelectionTextPayload) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, SELECTION_TEXT_EVENT, payload.clone()) {
        tracing::warn!(error = %err, "failed to emit selection text to main window");
    }
}

#[cfg(not(test))]
pub(crate) fn emit_selection_failure(app: &AppHandle, error: &Error) {
    let payload = SelectionFailurePayload {
        message: selection_failure_message(error),
    };
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, RESULT_SELECTION_FAILED_EVENT, payload) {
        tracing::warn!(error = %err, "failed to emit selection failure to main window");
    }
}

pub(crate) fn selection_failure_message(error: &Error) -> String {
    let message = error.to_string();
    if message.contains("Accessibility permission is required") {
        return "需要先授权系统辅助功能权限。请在系统设置 -> 隐私与安全性 -> 辅助功能 中允许 SnapText，然后重新使用划词。".to_owned();
    }
    if message.contains("no selected text is available") {
        return "未读取到选中文本，请先选中文本后再使用划词。".to_owned();
    }
    if message.contains("selected text could not be decoded correctly") {
        return "选中文本解码失败，请重新选择文本后再试。".to_owned();
    }
    message
}

#[cfg(target_os = "macos")]
pub(crate) fn emit_overlay_ocr_started(app: &AppHandle, region: snaptext_core::ocr::BBox) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, OVERLAY_OCR_STARTED_EVENT, region) {
        tracing::warn!(error = %err, "failed to emit overlay OCR started");
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn emit_overlay_ocr_failed(app: &AppHandle, region: snaptext_core::ocr::BBox) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, OVERLAY_OCR_FAILED_EVENT, region) {
        tracing::warn!(error = %err, "failed to emit overlay OCR failure");
    }
}

pub(crate) fn emit_overlay_ocr(
    app: &AppHandle,
    result: OcrTextResult,
    region: snaptext_core::ocr::BBox,
    translate_after_ocr: bool,
) {
    let event = OverlayOcrPayload {
        result,
        translate_after_ocr,
        region,
    };
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, OVERLAY_OCR_EVENT, event) {
        tracing::warn!(error = %err, "failed to emit overlay OCR result");
    }
}

pub(crate) fn history_record_to_translation_result(record: &HistoryRecord) -> TranslationResult {
    TranslationResult {
        source: record.source.clone(),
        source_text: record.source_text.clone(),
        translated_text: record.translated_text.clone(),
        target_lang: record.target_lang.clone(),
        text_lines: Vec::new(),
        dictionary_entries: record.dictionary_entries.clone(),
    }
}

pub(crate) fn parse_history_source(source: &str) -> Result<HistorySource> {
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
