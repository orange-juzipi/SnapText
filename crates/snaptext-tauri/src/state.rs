#[cfg(not(test))]
use std::collections::HashMap;
#[cfg(not(test))]
use std::sync::atomic::AtomicBool;
#[cfg(not(test))]
use std::time::Instant;
use std::{
    path::PathBuf,
    sync::{Mutex, RwLock},
};

#[cfg(not(test))]
use snaptext_core::hotkey::HotkeyAction;
use snaptext_core::{
    Result, config::AppConfig, history::HistoryStore, ocr::OcrEngine, screenshot::Screencap,
    selection::SelectionWatcher, translate::TranslatorRegistry,
};

#[cfg(target_os = "macos")]
use crate::voice_input::VoiceInputSession;
use crate::{ScreenshotPayload, model::resolve_model_dir, translator_registry_for_config};

pub struct AppState {
    pub(crate) config_path: Option<PathBuf>,
    pub(crate) resource_dir: Option<PathBuf>,
    pub(crate) config: RwLock<AppConfig>,
    pub(crate) history: Mutex<HistoryStore>,
    pub(crate) ocr: RwLock<OcrEngine>,
    pub(crate) screencap: Screencap,
    pub(crate) selection: SelectionWatcher,
    pub(crate) pending_overlay: Mutex<Option<OverlaySession>>,
    #[cfg(target_os = "macos")]
    pub(crate) voice_input: Mutex<Option<VoiceInputSession>>,
    pub(crate) translator: RwLock<TranslatorRegistry>,
    #[cfg(test)]
    pub(crate) fake_translated_text: Mutex<Option<String>>,
    #[cfg(not(test))]
    pub(crate) hotkey_routes: RwLock<HashMap<u32, HotkeyAction>>,
    #[cfg(not(test))]
    pub(crate) selection_hotkey_busy: AtomicBool,
    #[cfg(not(test))]
    pub(crate) last_selection_hotkey_at: Mutex<Option<Instant>>,
}

#[derive(Debug, Clone)]
pub(crate) struct OverlaySession {
    pub(crate) screenshot: ScreenshotPayload,
    pub(crate) restore_main_window: bool,
}

impl AppState {
    #[allow(dead_code)]
    pub fn new(config: AppConfig, history: HistoryStore) -> Result<Self> {
        Self::with_config_path(config, history, None)
    }

    #[allow(dead_code)]
    pub fn with_resource_dir(
        config: AppConfig,
        history: HistoryStore,
        resource_dir: Option<PathBuf>,
    ) -> Result<Self> {
        Self::build(config, history, None, resource_dir)
    }

    #[allow(dead_code)]
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
        let translator = translator_registry_for_config(&config)?;
        Ok(Self {
            config_path,
            resource_dir,
            config: RwLock::new(config),
            history: Mutex::new(history),
            ocr: RwLock::new(ocr),
            screencap: Screencap::new()?,
            selection: SelectionWatcher::new()?,
            pending_overlay: Mutex::new(None),
            #[cfg(target_os = "macos")]
            voice_input: Mutex::new(None),
            translator: RwLock::new(translator),
            #[cfg(test)]
            fake_translated_text: Mutex::new(None),
            #[cfg(not(test))]
            hotkey_routes: RwLock::new(HashMap::new()),
            #[cfg(not(test))]
            selection_hotkey_busy: AtomicBool::new(false),
            #[cfg(not(test))]
            last_selection_hotkey_at: Mutex::new(None),
        })
    }
}
