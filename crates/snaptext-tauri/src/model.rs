use std::path::PathBuf;

use snaptext_core::config::{AppConfig, ModelDir};

pub(crate) fn resolve_model_dir(
    config: &AppConfig,
    resource_dir: Option<&std::path::Path>,
) -> PathBuf {
    match &config.ocr.model_dir {
        ModelDir::Bundled(_) => resource_dir
            .map(|dir| dir.join("models"))
            .unwrap_or_else(|| PathBuf::from("models")),
        ModelDir::Custom(path) => path.clone(),
    }
}
