import { tauriInvoke } from "@/lib/tauri";
import type {
  AppConfig,
  HistoryRecord,
  OcrModelStatus,
  OcrTextResult,
  OverlayTranslationPayload,
  Region,
  ScreenshotPayload,
  TranslationRequest,
  TranslationResult,
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

export function clearHistory() {
  return tauriInvoke<void>("clear_history");
}

export function validateOcrModels() {
  return tauriInvoke<OcrModelStatus>("validate_ocr_models");
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

export function translateImageBase64(base64Png: string) {
  return tauriInvoke<TranslationResult>("translate_image_base64", { base64Png });
}

export function translateScreenshotBase64(base64Png: string) {
  return tauriInvoke<TranslationResult>("translate_screenshot_base64", { base64Png });
}

export function translateScreenshotRegion(bbox: Region) {
  return tauriInvoke<TranslationResult>("translate_screenshot_region", { bbox });
}

export function ocrImageRegion(base64Png: string, bbox: Region) {
  return tauriInvoke<OcrTextResult>("ocr_image_region", { base64Png, bbox });
}

export function ocrScreenshotRegion(bbox: Region) {
  return tauriInvoke<OcrTextResult>("ocr_screenshot_region", { bbox });
}

export function ocrOverlaySelection(bbox: Region) {
  return tauriInvoke<OcrTextResult>("ocr_overlay_selection", { bbox });
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

export function translateText(sourceText: string, targetLang?: string) {
  return tauriInvoke<HistoryRecord>("translate_text", { sourceText, targetLang });
}

export function retranslateResultText(request: TranslationRequest) {
  return tauriInvoke<HistoryRecord>("retranslate_result_text", {
    source: request.source,
    sourceText: request.source_text,
    targetLang: request.target_lang,
  });
}

export function pinResultWindow() {
  return tauriInvoke<void>("pin_result_window");
}

export function unpinResultWindow() {
  return tauriInvoke<void>("unpin_result_window");
}
