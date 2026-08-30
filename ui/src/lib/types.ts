export type AppConfig = {
  target_lang: string;
  ui: UiConfig;
  hotkeys: HotkeyConfig;
  translator: TranslatorConfig;
  ocr: OcrConfig;
  speech: SpeechConfig;
};

export type UiConfig = {
  theme: string;
  language: string;
  result_panel_dock: string;
  /** Controls whether source text is translated after the debounce window. */
  auto_translate: boolean;
  /** Controls whether closing the native main window exits or hides the application. */
  close_behavior: string;
};

export type HotkeyConfig = {
  screenshot: string;
  selection: string;
};

export type TranslatorConfig = {
  provider: string;
  snaptext_cloud: SnapTextCloudConfig;
  openai_compatible: OpenAiConfig;
  deepl: DeepLConfig;
  google: GoogleConfig;
  local_http: LocalHttpConfig;
};

export type SnapTextCloudConfig = {
  endpoint: string;
  device_id: string;
  enabled: boolean;
};

export type OpenAiConfig = {
  base_url: string;
  api_key?: string | null;
  model: string;
};

export type DeepLConfig = {
  api_key?: string | null;
  base_url: string;
};

export type GoogleConfig = {
  api_key?: string | null;
  base_url: string;
};

export type LocalHttpConfig = {
  endpoint: string;
};

export type OcrConfig = {
  model_dir: string;
  use_gpu: boolean;
};

export type SpeechConfig = {
  enabled: boolean;
  english_accent: string;
  english_accents: string[];
  rate: number;
  volume: number;
};

export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HistoryRecord = {
  id: number;
  created_at: number;
  source: string;
  source_text: string;
  target_lang: string;
  translated_text: string;
  dictionary_entries?: DictionaryEntry[];
};

export type DictionaryEntry = {
  headword: string;
  phonetic?: string | null;
  audio_url?: string | null;
  part_of_speech: string;
  translations?: string[];
  definitions?: string[];
  source: string;
};

export type SelectionFailurePayload = {
  message: string;
};

export type SelectionTextPayload = {
  text: string;
  app_bundle_id?: string | null;
};

export type ScreenshotPayload = {
  meta: ScreenshotMeta;
  base64_png: string;
};

export type ScreenshotMeta = {
  width: number;
  height: number;
  path?: string | null;
};

export type TranslationResult = {
  source: string;
  source_text: string;
  translated_text: string;
  target_lang: string;
  text_lines: TextLine[];
  dictionary_entries?: DictionaryEntry[];
};

export type OcrTextResult = {
  source_text: string;
  text_lines: TextLine[];
};

export type TextLine = {
  text: string;
  bbox: BBox;
  confidence: number;
};

export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OverlayTranslationPayload = {
  result: TranslationResult;
  region: Region;
};

export type OverlayOcrPayload = {
  /** OCR region in screen coordinates. */
  result: OcrTextResult;
  /** Whether the overlay action should continue into translation. */
  translate_after_ocr: boolean;
  region: Region;
};

export type PinnedResultPayload = {
  /** Source kind serialized by the native result snapshot. */
  source: string;
  /** Source or OCR text shown in the result window. */
  source_text: string;
  /** Translated output shown in the result window. */
  translated_text: string;
  /** Target language used for the output. */
  target_lang: string;
  /** Optional dictionary entries attached to the result. */
  dictionary_entries?: DictionaryEntry[];
};

/** Options applied to a user-provided image before local OCR. */
export type ImagePreprocessOptions = {
  /** Multiplicative resize applied after rotation. */
  scale: number;
  /** Converts the image to grayscale before OCR. */
  grayscale: boolean;
  /** Contrast multiplier where 1 keeps the original contrast. */
  contrast: number;
  /** Applies a local unsharp mask after resizing to clarify glyph edges. */
  sharpen: boolean;
  /** Clockwise rotation in degrees; supported values are 0, 90, 180, and 270. */
  rotation: 0 | 90 | 180 | 270;
};

export type TranslationRequest = {
  source: string;
  source_text: string;
  target_lang?: string;
};

export type VoiceInputResult = {
  text: string;
};

export type VoiceInputPartialPayload = {
  text: string;
  final_result: boolean;
};

export type WindowKind = "main" | "overlay" | "result";

export type WorkspaceSnapshot = {
  /** Latest translated text shown in the result panel. */
  result: string;
  /** Source text associated with the latest result. */
  sourceText: string;
  /** Source kind used for history and result-window labels. */
  sourceKind: string;
  /** Target language associated with the latest result. */
  targetLang: string;
  /** Dictionary entries associated with the latest result. */
  dictionaryEntries: DictionaryEntry[];
  /** OCR text boxes and confidence values for the source text. */
  textLines: TextLine[];
  /** Keeps OCR-only results from being translated before the user reviews them. */
  requiresReview: boolean;
};
