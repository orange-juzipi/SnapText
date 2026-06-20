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

export type OcrModelStatus = {
  model_dir: string;
  valid: boolean;
  missing_files: string[];
  recognition_dict_len: number;
  loadable: boolean;
  message: string;
};

export type DesktopCapabilityStatus = {
  capability: string;
  status: string;
  action: string;
};

export type OverlayTranslationPayload = {
  result: TranslationResult;
  region: Region;
};

export type OverlayOcrPayload = {
  result: OcrTextResult;
  region: Region;
};

export type PinnedResultPayload = {
  source: string;
  source_text: string;
  translated_text: string;
  target_lang: string;
};

export type TranslationRequest = {
  source: string;
  source_text: string;
  target_lang?: string;
};

export type WindowKind = "main" | "overlay" | "result";

export type WorkspaceSnapshot = {
  result: string;
  sourceText: string;
  sourceKind: string;
  targetLang: string;
};
