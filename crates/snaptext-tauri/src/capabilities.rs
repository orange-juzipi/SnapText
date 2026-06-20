use snaptext_core::{Error, Result};

use crate::AppState;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OcrModelStatus {
    pub model_dir: String,
    pub valid: bool,
    pub missing_files: Vec<String>,
    pub recognition_dict_len: usize,
    pub loadable: bool,
    pub message: String,
}

pub(crate) fn validate_ocr_models_inner(state: &AppState) -> Result<OcrModelStatus> {
    let ocr = state
        .ocr
        .read()
        .map_err(|err| Error::Ocr(err.to_string()))?
        .clone();
    let manifest = ocr.manifest();
    let expected = [
        (&manifest.det, snaptext_core::ocr::DET_MODEL_FILE),
        (&manifest.cls, snaptext_core::ocr::CLS_MODEL_FILE),
        (&manifest.rec, snaptext_core::ocr::REC_MODEL_FILE),
        (&manifest.rec_dict, snaptext_core::ocr::REC_DICT_FILE),
    ];
    let missing_files = expected
        .iter()
        .filter_map(|(path, label)| (!path.is_file()).then_some((*label).to_owned()))
        .collect::<Vec<_>>();

    if !missing_files.is_empty() {
        return Ok(OcrModelStatus {
            model_dir: ocr.model_dir().display().to_string(),
            valid: false,
            missing_files,
            recognition_dict_len: 0,
            loadable: false,
            message: String::from("OCR model directory is missing required files."),
        });
    }

    let assets = ocr.validate_assets()?;
    // Loading every ONNX session catches corrupted or mismatched model files before a
    // screenshot/image translation request reaches the full OCR pipeline.
    if let Err(err) = ocr.load_sessions() {
        return Ok(OcrModelStatus {
            model_dir: ocr.model_dir().display().to_string(),
            valid: false,
            missing_files,
            recognition_dict_len: assets.recognition_dict_len,
            loadable: false,
            message: format!("OCR model files exist, but ONNX sessions failed to load: {err}"),
        });
    }

    Ok(OcrModelStatus {
        model_dir: ocr.model_dir().display().to_string(),
        valid: true,
        missing_files,
        recognition_dict_len: assets.recognition_dict_len,
        loadable: true,
        message: String::from("OCR model files and ONNX sessions are ready."),
    })
}
