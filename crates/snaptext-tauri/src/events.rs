use snaptext_core::{Error, Result, history::HistoryRecord, pipeline::TranslationResult};
use tauri::{AppHandle, Emitter};

use crate::{HistorySource, MAIN_WINDOW_LABEL, OcrTextResult};

const RESULT_TRANSLATION_EVENT: &str = "snaptext://result-translation";
const RESULT_SELECTION_EVENT: &str = "snaptext://result-selection";
#[cfg(not(test))]
const SELECTION_TEXT_EVENT: &str = "snaptext://selection-text";
#[cfg(not(test))]
const RESULT_SELECTION_FAILED_EVENT: &str = "snaptext://result-selection-failed";
const RESULT_WINDOW_STATE_EVENT: &str = "snaptext://result-window-state";
const OVERLAY_TRANSLATION_EVENT: &str = "snaptext://overlay-translation";
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
    pub result: OcrTextResult,
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
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, RESULT_TRANSLATION_EVENT, result.clone()) {
        tracing::warn!(error = %err, "failed to emit result translation to main window");
    }
}

pub(crate) fn emit_selection_record(app: &AppHandle, record: &HistoryRecord) {
    if let Err(err) = app.emit_to(MAIN_WINDOW_LABEL, RESULT_SELECTION_EVENT, record.clone()) {
        tracing::warn!(error = %err, "failed to emit selection result to main window");
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
) {
    let event = OverlayOcrPayload { result, region };
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
