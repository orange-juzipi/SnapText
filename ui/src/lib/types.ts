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
  /** 云翻译隐私模式；启用后服务端不会缓存该请求。 */
  privacy_sensitive: boolean;
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

/** 用户本机 OpenAI-compatible TTS 服务配置。 */
export type LocalSpeechConfig = {
  /** 完整的 `/v1/audio/speech` HTTP(S) 地址。 */
  endpoint: string;
  /** 可选的本地服务 Bearer token。 */
  api_key?: string | null;
  /** TTS 模型标识。 */
  model: string;
  /** 服务端音色标识。 */
  voice: string;
  /** OpenAI-compatible 音频响应格式。 */
  response_format: "wav" | "mp3";
};

/** Tauri 原生层返回的完整本地音频。 */
export type LocalSpeechAudio = {
  /** Base64 编码的音频响应。 */
  audio_base64: string;
  /** 与请求格式对应的 MIME 类型。 */
  content_type: string;
};

export type SpeechConfig = {
  /** 是否启用朗读。 */
  enabled: boolean;
  /** 系统、SnapText Cloud 或自定义 OpenAI-compatible 朗读来源。 */
  engine: "system" | "snaptext_cloud" | "local_openai_compatible";
  /** 按语言保存的音色标识；不含密钥。 */
  cloud_voice_by_lang: Record<string, string>;
  /** 用户自行配置的 OpenAI-compatible 语音服务。 */
  local_ai: LocalSpeechConfig;
  /** 默认英文口音。 */
  english_accent: string;
  /** 朗读按钮显示的英文口音。 */
  english_accents: string[];
  /** 系统语速或 AI 合成参考语速。 */
  rate: number;
  /** 本地音量，不传给供应商。 */
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
