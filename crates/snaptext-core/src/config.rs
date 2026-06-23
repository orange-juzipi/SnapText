use std::{fs, path::PathBuf};

use directories::ProjectDirs;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use url::Url;

use crate::cloud_auth::normalize_cloud_device_id;
use crate::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct AppConfig {
    pub target_lang: Lang,
    pub ui: UiConfig,
    pub hotkeys: HotkeyConfig,
    pub translator: TranslatorConfig,
    pub ocr: OcrConfig,
    #[serde(default)]
    pub speech: SpeechConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct UiConfig {
    pub theme: Theme,
    #[serde(default = "default_ui_language")]
    pub language: UiLanguage,
    pub result_panel_dock: ResultPanelDock,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UiLanguage {
    ZhCn,
    En,
}

fn default_ui_language() -> UiLanguage {
    UiLanguage::ZhCn
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResultPanelDock {
    Cursor,
    Fixed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HotkeyConfig {
    pub screenshot: String,
    pub selection: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct OcrConfig {
    pub model_dir: ModelDir,
    pub use_gpu: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelDir {
    Bundled(String),
    Custom(PathBuf),
}

impl Serialize for ModelDir {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            ModelDir::Bundled(value) => serializer.serialize_str(value),
            ModelDir::Custom(path) => serializer.serialize_str(&path.to_string_lossy()),
        }
    }
}

impl<'de> Deserialize<'de> for ModelDir {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value.trim().is_empty() || value == "bundled" {
            Ok(ModelDir::Bundled("bundled".to_owned()))
        } else {
            // Any non-bundled string is treated as a concrete filesystem model directory.
            Ok(ModelDir::Custom(PathBuf::from(value)))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct Lang(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct TranslatorConfig {
    pub provider: TranslatorProvider,
    #[serde(default)]
    pub snaptext_cloud: SnapTextCloudConfig,
    pub openai_compatible: OpenAiCompatibleConfig,
    pub deepl: DeepLConfig,
    pub google: GoogleConfig,
    pub local_http: LocalHttpConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranslatorProvider {
    #[serde(rename = "snaptext_cloud", alias = "snap_text_cloud")]
    SnapTextCloud,
    #[serde(rename = "openai_compatible", alias = "open_ai_compatible")]
    OpenAiCompatible,
    DeepL,
    Google,
    LocalHttp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapTextCloudConfig {
    pub endpoint: Url,
    pub device_id: String,
    pub enabled: bool,
}

impl Default for SnapTextCloudConfig {
    fn default() -> Self {
        Self {
            endpoint: default_snaptext_cloud_endpoint(),
            device_id: default_snaptext_cloud_device_id(),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenAiCompatibleConfig {
    pub base_url: Url,
    pub api_key: Option<String>,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeepLConfig {
    pub api_key: Option<String>,
    pub base_url: Url,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleConfig {
    pub api_key: Option<String>,
    pub base_url: Url,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalHttpConfig {
    pub endpoint: Url,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct SpeechConfig {
    pub enabled: bool,
    #[serde(default = "default_english_accent")]
    pub english_accent: EnglishAccent,
    #[serde(default = "default_english_accents")]
    pub english_accents: Vec<EnglishAccent>,
    pub rate: f32,
    pub volume: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EnglishAccent {
    American,
    British,
}

impl Default for SpeechConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            english_accent: EnglishAccent::American,
            english_accents: default_english_accents(),
            rate: 1.0,
            volume: 1.0,
        }
    }
}

fn default_english_accent() -> EnglishAccent {
    EnglishAccent::American
}

fn default_english_accents() -> Vec<EnglishAccent> {
    vec![EnglishAccent::American, EnglishAccent::British]
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            target_lang: Lang("zh_cn".to_owned()),
            ui: UiConfig {
                theme: Theme::System,
                language: UiLanguage::ZhCn,
                result_panel_dock: ResultPanelDock::Cursor,
            },
            hotkeys: HotkeyConfig {
                screenshot: "Alt+W".to_owned(),
                selection: "Alt+E".to_owned(),
            },
            translator: TranslatorConfig {
                provider: TranslatorProvider::SnapTextCloud,
                snaptext_cloud: SnapTextCloudConfig {
                    endpoint: default_snaptext_cloud_endpoint(),
                    device_id: default_snaptext_cloud_device_id(),
                    enabled: true,
                },
                openai_compatible: OpenAiCompatibleConfig {
                    base_url: Url::parse("https://api.openai.com/v1").expect("valid default URL"),
                    api_key: None,
                    model: "gpt-4o-mini".to_owned(),
                },
                deepl: DeepLConfig {
                    api_key: None,
                    base_url: Url::parse("https://api-free.deepl.com/v2")
                        .expect("valid default URL"),
                },
                google: GoogleConfig {
                    api_key: None,
                    base_url: Url::parse(
                        "https://translation.googleapis.com/language/translate/v2",
                    )
                    .expect("valid default URL"),
                },
                local_http: LocalHttpConfig {
                    endpoint: Url::parse("http://127.0.0.1:8080/translate")
                        .expect("valid default URL"),
                },
            },
            ocr: OcrConfig {
                model_dir: ModelDir::Bundled("bundled".to_owned()),
                use_gpu: false,
            },
            speech: SpeechConfig::default(),
        }
    }
}

impl AppConfig {
    pub fn load_or_default(path: Option<PathBuf>) -> Result<Self> {
        let path = path.unwrap_or_else(default_config_path);
        if !path.exists() {
            return Ok(Self::default());
        }

        let content = fs::read_to_string(path)?;
        let config: Self = serde_yaml::from_str(&content)?;
        let config = config.normalized_for_save();
        config.validate()?;
        Ok(config)
    }

    pub fn save(&self, path: Option<PathBuf>) -> Result<PathBuf> {
        let normalized = self.clone().normalized_for_save();
        normalized.validate()?;
        let path = path.unwrap_or_else(default_config_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let content = serde_yaml::to_string(&normalized)?;
        fs::write(&path, content)?;
        Ok(path)
    }

    pub fn validate(&self) -> Result<()> {
        ensure_supported_target_lang(&self.target_lang)?;
        validate_hotkey("screenshot", &self.hotkeys.screenshot)?;
        validate_hotkey("selection", &self.hotkeys.selection)?;
        validate_hotkey_conflicts(&self.hotkeys)?;
        validate_translator_config(&self.translator)?;
        validate_model_dir(&self.ocr.model_dir)?;
        validate_speech_config(&self.speech)?;
        Ok(())
    }

    pub fn normalized_for_save(mut self) -> Self {
        self.target_lang.0 = self.target_lang.0.trim().to_owned();
        self.hotkeys.screenshot = self.hotkeys.screenshot.trim().to_owned();
        self.hotkeys.selection = self.hotkeys.selection.trim().to_owned();
        self.translator.provider = normalize_translator_provider(self.translator.provider);
        // 官方源地址不作为用户配置保存；本地调试由桌面进程运行时覆盖。
        self.translator.snaptext_cloud.endpoint = snaptext_cloud_production_endpoint();
        self.translator.snaptext_cloud.device_id =
            normalize_device_id(self.translator.snaptext_cloud.device_id);
        self.translator.openai_compatible.model =
            self.translator.openai_compatible.model.trim().to_owned();
        trim_optional_secret(&mut self.translator.openai_compatible.api_key);
        trim_optional_secret(&mut self.translator.deepl.api_key);
        trim_optional_secret(&mut self.translator.google.api_key);
        self.ocr.model_dir = normalize_model_dir(self.ocr.model_dir);
        self.speech = normalize_speech_config(self.speech);
        self
    }
}

pub fn app_config_dir() -> PathBuf {
    project_dirs()
        .map(|dirs| dirs.config_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from(".snaptext"))
}

pub fn app_data_dir() -> PathBuf {
    project_dirs()
        .map(|dirs| dirs.data_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from(".snaptext"))
}

pub fn default_config_path() -> PathBuf {
    app_config_dir().join("config.yaml")
}

pub fn default_history_path() -> PathBuf {
    app_data_dir().join("history.sqlite3")
}

fn project_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from("com", "SnapText", "SnapText")
}

pub fn ensure_supported_target_lang(lang: &Lang) -> Result<()> {
    if lang.0.trim().is_empty() {
        return Err(Error::Config("target language cannot be empty".to_owned()));
    }

    Ok(())
}

fn validate_hotkey(name: &str, value: &str) -> Result<()> {
    let value = value.trim();
    if value.is_empty() {
        return Err(Error::Config(format!("{name} hotkey cannot be empty")));
    }

    let parts = value.split('+').map(str::trim).collect::<Vec<_>>();
    if parts.iter().any(|part| part.is_empty()) {
        return Err(Error::Config(format!(
            "{name} hotkey contains an empty key segment"
        )));
    }
    if parts.len() < 2 {
        return Err(Error::Config(format!(
            "{name} hotkey must include at least one modifier and one key"
        )));
    }

    let (modifiers, key) = parts.split_at(parts.len() - 1);
    let key = key[0];
    if is_hotkey_modifier(key) {
        return Err(Error::Config(format!(
            "{name} hotkey must end with a non-modifier key"
        )));
    }
    if !is_supported_hotkey_key(key) {
        return Err(Error::Config(format!(
            "{name} hotkey key `{key}` is not supported"
        )));
    }

    let mut normalized_modifiers = Vec::new();
    for modifier in modifiers {
        let Some(normalized) = normalize_hotkey_modifier(modifier) else {
            return Err(Error::Config(format!(
                "{name} hotkey modifier `{modifier}` is not supported"
            )));
        };
        if normalized_modifiers.contains(&normalized) {
            return Err(Error::Config(format!(
                "{name} hotkey modifier `{modifier}` is duplicated"
            )));
        }
        normalized_modifiers.push(normalized);
    }

    Ok(())
}

fn validate_hotkey_conflicts(config: &HotkeyConfig) -> Result<()> {
    if config
        .screenshot
        .trim()
        .eq_ignore_ascii_case(config.selection.trim())
    {
        return Err(Error::Config(
            "screenshot and selection hotkeys must be different".to_owned(),
        ));
    }

    Ok(())
}

fn normalize_hotkey_modifier(value: &str) -> Option<&'static str> {
    match value.to_ascii_lowercase().as_str() {
        "cmdorctrl" | "commandorcontrol" | "super" | "meta" => Some("cmdorctrl"),
        "cmd" | "command" => Some("cmd"),
        "ctrl" | "control" => Some("ctrl"),
        "shift" => Some("shift"),
        "alt" | "option" => Some("alt"),
        _ => None,
    }
}

fn is_hotkey_modifier(value: &str) -> bool {
    normalize_hotkey_modifier(value).is_some()
}

fn is_supported_hotkey_key(value: &str) -> bool {
    let key = value.trim();
    if key.chars().count() == 1 {
        return key.chars().all(|ch| ch.is_ascii_alphanumeric());
    }

    matches!(
        key.to_ascii_lowercase().as_str(),
        "space"
            | "enter"
            | "return"
            | "tab"
            | "escape"
            | "esc"
            | "backspace"
            | "delete"
            | "insert"
            | "home"
            | "end"
            | "pageup"
            | "pagedown"
            | "up"
            | "down"
            | "left"
            | "right"
            | "f1"
            | "f2"
            | "f3"
            | "f4"
            | "f5"
            | "f6"
            | "f7"
            | "f8"
            | "f9"
            | "f10"
            | "f11"
            | "f12"
    )
}

fn validate_translator_config(config: &TranslatorConfig) -> Result<()> {
    match config.provider {
        TranslatorProvider::SnapTextCloud => {
            validate_snaptext_cloud_config(&config.snaptext_cloud)?
        }
        TranslatorProvider::DeepL => validate_deepl_config(&config.deepl)?,
        TranslatorProvider::Google => validate_google_config(&config.google)?,
        // These providers are kept only so older config files can deserialize.
        // UI and runtime normalization migrate them to SnapText Cloud.
        TranslatorProvider::OpenAiCompatible | TranslatorProvider::LocalHttp => {}
    }
    Ok(())
}

fn validate_snaptext_cloud_config(config: &SnapTextCloudConfig) -> Result<()> {
    ensure_http_url("SnapText Cloud endpoint", &config.endpoint)?;
    if config.device_id.trim().is_empty() {
        return Err(Error::Config(
            "SnapText Cloud device ID cannot be empty".to_owned(),
        ));
    }
    Ok(())
}

fn validate_deepl_config(config: &DeepLConfig) -> Result<()> {
    ensure_http_url("DeepL base URL", &config.base_url)
}

fn validate_google_config(config: &GoogleConfig) -> Result<()> {
    ensure_http_url("Google base URL", &config.base_url)
}

fn validate_model_dir(model_dir: &ModelDir) -> Result<()> {
    match model_dir {
        ModelDir::Bundled(value) => {
            if value.trim().is_empty() {
                return Err(Error::Config(
                    "bundled model directory marker cannot be empty".to_owned(),
                ));
            }
        }
        ModelDir::Custom(path) => {
            if path.as_os_str().is_empty() {
                return Err(Error::Config(
                    "custom model directory cannot be empty".to_owned(),
                ));
            }
        }
    }

    Ok(())
}

fn validate_speech_config(config: &SpeechConfig) -> Result<()> {
    if !(0.1..=3.0).contains(&config.rate) {
        return Err(Error::Config(
            "speech rate must be between 0.1 and 3.0".to_owned(),
        ));
    }
    if !(0.0..=1.0).contains(&config.volume) {
        return Err(Error::Config(
            "speech volume must be between 0.0 and 1.0".to_owned(),
        ));
    }
    Ok(())
}

fn trim_optional_secret(value: &mut Option<String>) {
    *value = value
        .take()
        .map(|secret| secret.trim().to_owned())
        .filter(|secret| !secret.is_empty());
}

fn normalize_model_dir(model_dir: ModelDir) -> ModelDir {
    match model_dir {
        ModelDir::Bundled(value) => {
            let value = value.trim();
            if value.is_empty() {
                ModelDir::Bundled("bundled".to_owned())
            } else {
                ModelDir::Bundled(value.to_owned())
            }
        }
        ModelDir::Custom(path) => {
            let path = PathBuf::from(path.to_string_lossy().trim().to_owned());
            if path.as_os_str().is_empty() {
                ModelDir::Bundled("bundled".to_owned())
            } else {
                ModelDir::Custom(path)
            }
        }
    }
}

fn normalize_speech_config(mut config: SpeechConfig) -> SpeechConfig {
    let mut english_accents = Vec::new();
    for accent in config.english_accents {
        if !english_accents.contains(&accent) {
            english_accents.push(accent);
        }
    }
    config.english_accents = english_accents;
    config.rate = config.rate.clamp(0.1, 3.0);
    config.volume = config.volume.clamp(0.0, 1.0);
    config
}

fn normalize_translator_provider(provider: TranslatorProvider) -> TranslatorProvider {
    match provider {
        TranslatorProvider::OpenAiCompatible | TranslatorProvider::LocalHttp => {
            TranslatorProvider::SnapTextCloud
        }
        provider => provider,
    }
}

pub fn snaptext_cloud_production_endpoint() -> Url {
    Url::parse("https://snaptext.uuidcx.com").expect("valid default URL")
}

fn default_snaptext_cloud_endpoint() -> Url {
    snaptext_cloud_production_endpoint()
}

pub fn default_snaptext_cloud_device_id() -> String {
    normalize_cloud_device_id(String::new())
}

fn normalize_device_id(device_id: String) -> String {
    normalize_cloud_device_id(device_id)
}

fn ensure_http_url(label: &str, url: &Url) -> Result<()> {
    match url.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(Error::Config(format!(
            "{label} must use http or https, got {scheme}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_plan_hotkeys() {
        let config = AppConfig::default();

        assert_eq!(config.hotkeys.screenshot, "Alt+W");
        assert_eq!(config.hotkeys.selection, "Alt+E");
        assert_eq!(config.target_lang, Lang("zh_cn".to_owned()));
        assert_eq!(config.ui.language, UiLanguage::ZhCn);
        assert_eq!(config.speech.english_accent, EnglishAccent::American);
        assert_eq!(
            config.speech.english_accents,
            vec![EnglishAccent::American, EnglishAccent::British]
        );
        assert_eq!(
            config.translator.snaptext_cloud.endpoint,
            snaptext_cloud_production_endpoint()
        );
    }

    #[test]
    fn config_round_trips_yaml() {
        let config = AppConfig::default();
        let yaml = serde_yaml::to_string(&config).expect("serialize config");
        let decoded: AppConfig = serde_yaml::from_str(&yaml).expect("deserialize config");

        assert_eq!(decoded, config);
    }

    #[test]
    fn normalized_for_save_trims_user_input_boundaries() {
        let mut config = AppConfig::default();
        config.target_lang.0 = " fr ".to_owned();
        config.hotkeys.screenshot = " CmdOrCtrl+Shift+T ".to_owned();
        config.hotkeys.selection = " Alt+F8 ".to_owned();
        config.translator.openai_compatible.model = " gpt-test ".to_owned();
        config.translator.openai_compatible.api_key = Some(" sk-test ".to_owned());
        config.translator.deepl.api_key = Some(" \n ".to_owned());
        config.translator.google.api_key = Some(" google-key ".to_owned());
        config.ocr.model_dir = ModelDir::Custom(PathBuf::from(" ./models "));
        config.speech.rate = 4.0;
        config.speech.volume = -1.0;
        config.speech.english_accents = vec![
            EnglishAccent::American,
            EnglishAccent::American,
            EnglishAccent::British,
        ];

        let normalized = config.normalized_for_save();

        assert_eq!(normalized.target_lang, Lang("fr".to_owned()));
        assert_eq!(normalized.hotkeys.screenshot, "CmdOrCtrl+Shift+T");
        assert_eq!(normalized.hotkeys.selection, "Alt+F8");
        assert_eq!(normalized.translator.openai_compatible.model, "gpt-test");
        assert_eq!(
            normalized.translator.openai_compatible.api_key.as_deref(),
            Some("sk-test")
        );
        assert_eq!(normalized.translator.deepl.api_key, None);
        assert_eq!(
            normalized.translator.google.api_key.as_deref(),
            Some("google-key")
        );
        assert_eq!(
            normalized.ocr.model_dir,
            ModelDir::Custom(PathBuf::from("./models"))
        );
        assert_eq!(
            normalized.speech.english_accents,
            vec![EnglishAccent::American, EnglishAccent::British]
        );
        assert_eq!(normalized.speech.rate, 3.0);
        assert_eq!(normalized.speech.volume, 0.0);
    }

    #[test]
    fn load_and_save_use_normalized_config_values() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let config_path = tempdir.path().join("config.yaml");
        let yaml = r#"
target_lang: " fr "
ui:
  theme: system
  result_panel_dock: cursor
hotkeys:
  screenshot: " CmdOrCtrl+Shift+T "
  selection: " Alt+F8 "
translator:
  provider: openai_compatible
  openai_compatible:
    base_url: https://api.openai.com/v1
    api_key: " sk-test "
    model: " gpt-test "
  deepl:
    api_key: "   "
    base_url: https://api-free.deepl.com/v2
  google:
    api_key: " google-key "
    base_url: https://translation.googleapis.com/language/translate/v2
  local_http:
    endpoint: http://127.0.0.1:8080/translate
ocr:
  model_dir: " ./models "
  use_gpu: false
speech:
  enabled: true
  english_accent: british
  english_accents:
    - american
  rate: 1.5
  volume: 0.8
"#;
        std::fs::write(&config_path, yaml).expect("write config");

        let loaded = AppConfig::load_or_default(Some(config_path.clone())).expect("load config");

        assert_eq!(loaded.target_lang, Lang("fr".to_owned()));
        assert_eq!(
            loaded.translator.provider,
            TranslatorProvider::SnapTextCloud
        );
        assert_eq!(loaded.hotkeys.screenshot, "CmdOrCtrl+Shift+T");
        assert_eq!(loaded.hotkeys.selection, "Alt+F8");
        assert_eq!(loaded.translator.openai_compatible.model, "gpt-test");
        assert_eq!(
            loaded.translator.openai_compatible.api_key.as_deref(),
            Some("sk-test")
        );
        assert_eq!(loaded.translator.deepl.api_key, None);
        assert_eq!(
            loaded.ocr.model_dir,
            ModelDir::Custom(PathBuf::from("./models"))
        );
        assert_eq!(loaded.speech.english_accent, EnglishAccent::British);
        assert_eq!(loaded.speech.english_accents, vec![EnglishAccent::American]);
        assert_eq!(loaded.speech.rate, 1.5);
        assert_eq!(loaded.speech.volume, 0.8);

        loaded.save(Some(config_path.clone())).expect("save config");
        let saved = std::fs::read_to_string(config_path).expect("saved config");

        assert!(saved.contains("target_lang: fr"));
        assert!(saved.contains("provider: snaptext_cloud"));
        assert!(saved.contains("screenshot: CmdOrCtrl+Shift+T"));
        assert!(saved.contains("selection: Alt+F8"));
        assert!(saved.contains("api_key: sk-test"));
        assert!(saved.contains("model: gpt-test"));
        assert!(saved.contains("english_accent: british"));
        assert!(saved.contains("english_accents:"));
        assert!(saved.contains("- american"));
        assert!(!saved.contains("\" fr \""));
        assert!(!saved.contains("\" sk-test \""));
    }

    #[test]
    fn legacy_config_without_speech_uses_default_speech_config() {
        let yaml = r#"
target_lang: en
ui:
  theme: system
  result_panel_dock: cursor
hotkeys:
  screenshot: CmdOrCtrl+Shift+T
  selection: CmdOrCtrl+Shift+D
translator:
  provider: snaptext_cloud
  openai_compatible:
    base_url: https://api.openai.com/v1
    api_key:
    model: gpt-4o-mini
  deepl:
    api_key:
    base_url: https://api-free.deepl.com/v2
  google:
    api_key:
    base_url: https://translation.googleapis.com/language/translate/v2
  local_http:
    endpoint: http://127.0.0.1:8080/translate
ocr:
  model_dir: bundled
  use_gpu: false
"#;

        let config: AppConfig = serde_yaml::from_str(yaml).expect("legacy config");

        assert_eq!(config.speech, SpeechConfig::default());
    }

    #[test]
    fn custom_model_dir_round_trips_from_string_path() {
        let yaml = r#"
target_lang: en
ui:
  theme: system
  result_panel_dock: cursor
hotkeys:
  screenshot: CmdOrCtrl+Shift+T
  selection: CmdOrCtrl+Shift+D
translator:
  provider: openai_compatible
  openai_compatible:
    base_url: https://api.openai.com/v1
    api_key:
    model: gpt-4o-mini
  deepl:
    api_key:
    base_url: https://api-free.deepl.com/v2
  google:
    api_key:
    base_url: https://translation.googleapis.com/language/translate/v2
  local_http:
    endpoint: http://127.0.0.1:8080/translate
ocr:
  model_dir: /opt/snaptext/models
  use_gpu: false
"#;

        let config: AppConfig = serde_yaml::from_str(yaml).expect("custom model config");

        assert_eq!(
            config.ocr.model_dir,
            ModelDir::Custom(PathBuf::from("/opt/snaptext/models"))
        );
    }

    #[test]
    fn provider_accepts_legacy_open_ai_compatible_name() {
        let provider: TranslatorProvider =
            serde_yaml::from_str("open_ai_compatible").expect("legacy provider name");

        assert_eq!(provider, TranslatorProvider::OpenAiCompatible);
        assert_eq!(
            serde_yaml::to_string(&provider).expect("serialize provider"),
            "openai_compatible\n"
        );
    }

    #[test]
    fn provider_uses_snaptext_cloud_name_without_extra_word_boundary() {
        let provider: TranslatorProvider =
            serde_yaml::from_str("snaptext_cloud").expect("frontend provider name");
        let legacy_provider: TranslatorProvider =
            serde_yaml::from_str("snap_text_cloud").expect("legacy provider name");

        assert_eq!(provider, TranslatorProvider::SnapTextCloud);
        assert_eq!(legacy_provider, TranslatorProvider::SnapTextCloud);
        assert_eq!(
            serde_yaml::to_string(&provider).expect("serialize provider"),
            "snaptext_cloud\n"
        );
    }

    #[test]
    fn normalized_config_migrates_removed_translator_providers() {
        let mut openai_config = AppConfig::default();
        openai_config.translator.provider = TranslatorProvider::OpenAiCompatible;
        let mut local_config = AppConfig::default();
        local_config.translator.provider = TranslatorProvider::LocalHttp;

        assert_eq!(
            openai_config.normalized_for_save().translator.provider,
            TranslatorProvider::SnapTextCloud
        );
        assert_eq!(
            local_config.normalized_for_save().translator.provider,
            TranslatorProvider::SnapTextCloud
        );
    }

    #[test]
    fn validate_rejects_empty_hotkey() {
        let mut config = AppConfig::default();
        config.hotkeys.selection = "   ".to_owned();

        let err = config.validate().expect_err("empty selection hotkey");

        assert!(err.to_string().contains("selection hotkey cannot be empty"));
    }

    #[test]
    fn validate_accepts_supported_hotkey_shapes() {
        let mut config = AppConfig::default();
        config.hotkeys.screenshot = "CmdOrCtrl+Shift+T".to_owned();
        config.hotkeys.selection = "Alt+F8".to_owned();

        config.validate().expect("supported hotkeys");
    }

    #[test]
    fn validate_rejects_hotkey_without_modifier() {
        let mut config = AppConfig::default();
        config.hotkeys.selection = "F8".to_owned();

        let err = config.validate().expect_err("missing modifier");

        assert!(
            err.to_string()
                .contains("selection hotkey must include at least one modifier and one key")
        );
    }

    #[test]
    fn validate_rejects_unknown_hotkey_modifier() {
        let mut config = AppConfig::default();
        config.hotkeys.selection = "Hyper+T".to_owned();

        let err = config.validate().expect_err("unknown modifier");

        assert!(
            err.to_string()
                .contains("selection hotkey modifier `Hyper` is not supported")
        );
    }

    #[test]
    fn validate_rejects_empty_hotkey_segment() {
        let mut config = AppConfig::default();
        config.hotkeys.selection = "CmdOrCtrl++T".to_owned();

        let err = config.validate().expect_err("empty segment");

        assert!(
            err.to_string()
                .contains("selection hotkey contains an empty key segment")
        );
    }

    #[test]
    fn validate_rejects_duplicate_hotkey_modifier() {
        let mut config = AppConfig::default();
        config.hotkeys.selection = "Ctrl+Control+T".to_owned();

        let err = config.validate().expect_err("duplicate modifier");

        assert!(
            err.to_string()
                .contains("selection hotkey modifier `Control` is duplicated")
        );
    }

    #[test]
    fn validate_rejects_hotkey_ending_with_modifier() {
        let mut config = AppConfig::default();
        config.hotkeys.selection = "CmdOrCtrl+Shift".to_owned();

        let err = config.validate().expect_err("missing key");

        assert!(
            err.to_string()
                .contains("selection hotkey must end with a non-modifier key")
        );
    }

    #[test]
    fn validate_rejects_duplicate_hotkeys() {
        let mut config = AppConfig::default();
        config.hotkeys.selection = "  alt+w  ".to_owned();

        let err = config.validate().expect_err("duplicate hotkey");

        assert!(
            err.to_string()
                .contains("screenshot and selection hotkeys must be different")
        );
    }

    #[test]
    fn validate_ignores_removed_provider_fields_when_not_selected() {
        let mut config = AppConfig::default();
        config.translator.openai_compatible.model = " ".to_owned();
        config.translator.local_http.endpoint =
            Url::parse("file:///tmp/translate").expect("valid file url");

        config
            .validate()
            .expect("removed provider fields are inert");
    }
}
