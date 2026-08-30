import { tauriInvoke } from "@/lib/tauri";
import type {
  AppConfig,
  ImagePreprocessOptions,
  HistoryRecord,
  OcrModelStatus,
  OcrTextResult,
  OverlayTranslationPayload,
  Region,
  ScreenshotPayload,
  TranslationRequest,
  TranslationResult,
  VoiceInputResult,
  PinnedResultPayload,
} from "@/lib/types";

export const events = {
  overlayTranslation: "snaptext://overlay-translation",
  overlayOcrStarted: "snaptext://overlay-ocr-started",
  overlayOcrFailed: "snaptext://overlay-ocr-failed",
  overlayOcr: "snaptext://overlay-ocr",
  resultTranslation: "snaptext://result-translation",
  resultSelection: "snaptext://result-selection",
  selectionText: "snaptext://selection-text",
  resultSelectionFailed: "snaptext://result-selection-failed",
  resultSnapshot: "snaptext://result-snapshot",
  resultWindowState: "snaptext://result-window-state",
  voiceInputPartial: "snaptext://voice-input-partial",
} as const;

export function getConfig() {
  return tauriInvoke<AppConfig>("get_config");
}

export function updateConfig(config: AppConfig) {
  return tauriInvoke<AppConfig>("update_config", { config });
}

export function getHistory(limit = 50) {
  return tauriInvoke<HistoryRecord[]>("get_history", { limit });
}

/** Loads local history using the same filters shown in the history screen. */
/** Searches local history with optional text, source, and inclusive date bounds. */
export function searchHistory(
  query?: string,
  source?: string,
  from?: number,
  to?: number,
  limit = 50,
) {
  return tauriInvoke<HistoryRecord[]>("search_history", { query, source, from, to, limit });
}

/** Removes one local history record by id. */
export function deleteHistory(id: number) {
  return tauriInvoke<void>("delete_history", { id });
}

export function clearHistory() {
  return tauriInvoke<void>("clear_history");
}

export function validateOcrModels() {
  return tauriInvoke<OcrModelStatus>("validate_ocr_models");
}

/** Opens a specific macOS privacy pane so the user can grant a required permission. */
export function openSystemSettings(section: "screen_recording" | "accessibility" | "microphone") {
  return tauriInvoke<void>("open_system_settings", { section });
}

/** Loads the latest result snapshot when the independent result window opens. */
export function getResultSnapshot() {
  return tauriInvoke<PinnedResultPayload | null>("get_result_snapshot");
}

export function screenshotFull() {
  return tauriInvoke<ScreenshotPayload>("screenshot_full");
}

export function startScreenshotOverlay() {
  return tauriInvoke<ScreenshotPayload>("start_screenshot_overlay");
}

export function getOverlayScreenshot() {
  return tauriInvoke<ScreenshotPayload | null>("get_overlay_screenshot");
}

export function clearOverlayScreenshot() {
  return tauriInvoke<void>("clear_overlay_screenshot");
}

export function closeOverlay() {
  return tauriInvoke<void>("close_overlay");
}

export function screenshotRegion(bbox: Region) {
  return tauriInvoke<ScreenshotPayload>("screenshot_region", { bbox });
}

/** Runs image OCR and translation with an optional crop and preprocessing profile. */
export function translateImageBase64(
  base64Png: string,
  bbox?: Region,
  preprocessOptions?: ImagePreprocessOptions,
) {
  return tauriInvoke<TranslationResult>("translate_image_base64", {
    base64Png,
    bbox,
    preprocessOptions,
  });
}

export function translateScreenshotBase64(base64Png: string) {
  return tauriInvoke<TranslationResult>("translate_screenshot_base64", { base64Png });
}

export function translateScreenshotRegion(bbox: Region) {
  return tauriInvoke<TranslationResult>("translate_screenshot_region", { bbox });
}

export function ocrImageRegion(
  base64Png: string,
  bbox: Region,
  preprocessOptions?: ImagePreprocessOptions,
) {
  return tauriInvoke<OcrTextResult>("ocr_image_region", { base64Png, bbox, preprocessOptions });
}

export function ocrScreenshotRegion(bbox: Region) {
  return tauriInvoke<OcrTextResult>("ocr_screenshot_region", { bbox });
}

export function ocrOverlaySelection(bbox: Region, translateAfterOcr = true) {
  return tauriInvoke<OcrTextResult>("ocr_overlay_selection", { bbox, translateAfterOcr });
}

export function translateOverlaySelection(bbox: Region) {
  return tauriInvoke<OverlayTranslationPayload["result"]>("translate_overlay_selection", { bbox });
}

export function translateCurrentSelection() {
  return tauriInvoke<HistoryRecord>("translate_current_selection");
}

export function translateSelection(text: string) {
  return tauriInvoke<HistoryRecord>("translate_selection", { text });
}

export function translateText(sourceText: string, targetLang?: string, sourceLang?: string) {
  return tauriInvoke<HistoryRecord>("translate_text", { sourceText, targetLang, sourceLang });
}

export function retranslateResultText(request: TranslationRequest) {
  return tauriInvoke<HistoryRecord>("retranslate_result_text", {
    source: request.source,
    sourceText: request.source_text,
    targetLang: request.target_lang,
  });
}

/** Opens the independent result window with the exact snapshot currently shown in the UI. */
export function pinResultWindow(snapshot?: PinnedResultPayload) {
  return tauriInvoke<void>("pin_result_window", { snapshot });
}

export function unpinResultWindow() {
  return tauriInvoke<void>("unpin_result_window");
}

export function voiceInputSupported() {
  return tauriInvoke<boolean>("voice_input_supported");
}

export function startVoiceInput(locale: string) {
  return tauriInvoke<void>("start_voice_input", { locale });
}

export function stopVoiceInput() {
  return tauriInvoke<VoiceInputResult>("stop_voice_input");
}
