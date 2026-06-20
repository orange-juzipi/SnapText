#[cfg(target_os = "macos")]
use snaptext_core::selection::selection_permission_status;
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct DesktopCapabilityStatus {
    pub capability: String,
    pub status: String,
    pub action: String,
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

pub(crate) fn desktop_capabilities(state: &AppState) -> Vec<DesktopCapabilityStatus> {
    vec![
        DesktopCapabilityStatus {
            capability: String::from("screenshot"),
            status: platform_screenshot_status(),
            action: platform_screenshot_action(),
        },
        DesktopCapabilityStatus {
            capability: String::from("selection"),
            status: platform_selection_status(),
            action: platform_selection_action(),
        },
        DesktopCapabilityStatus {
            capability: String::from("global_hotkey"),
            status: String::from("configured"),
            action: String::from("Registered through the Tauri global shortcut plugin."),
        },
        DesktopCapabilityStatus {
            capability: String::from("ocr_models"),
            status: ocr_models_capability_status(state),
            action: ocr_models_capability_action(state),
        },
    ]
}

fn platform_screenshot_status() -> String {
    #[cfg(target_os = "macos")]
    {
        String::from("requires_screen_recording_permission")
    }
    #[cfg(target_os = "windows")]
    {
        String::from("available")
    }
    #[cfg(target_os = "linux")]
    {
        String::from("depends_on_compositor_portal")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        String::from("unsupported_platform")
    }
}

fn platform_screenshot_action() -> String {
    #[cfg(target_os = "macos")]
    {
        String::from(
            "Grant Screen Recording permission to SnapText in System Settings -> Privacy & Security -> Screen & System Audio Recording, then restart SnapText.",
        )
    }
    #[cfg(target_os = "windows")]
    {
        String::from(
            "No extra OS permission is normally required. If capture fails for an elevated app, restart SnapText with matching privileges.",
        )
    }
    #[cfg(target_os = "linux")]
    {
        String::from(
            "Use an X11 session or a Wayland compositor/portal path supported by xcap; if capture fails, verify desktop portal and compositor screenshot permissions.",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        String::from("SnapText only targets macOS, Windows, and Linux desktops.")
    }
}

fn platform_selection_status() -> String {
    #[cfg(target_os = "macos")]
    {
        String::from(selection_permission_status())
    }
    #[cfg(target_os = "windows")]
    {
        String::from("uses_ui_automation")
    }
    #[cfg(target_os = "linux")]
    {
        String::from("requires_selection_tools")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        String::from("unsupported_platform")
    }
}

fn platform_selection_action() -> String {
    #[cfg(target_os = "macos")]
    {
        String::from(
            "Grant Accessibility permission to SnapText in System Settings -> Privacy & Security -> Accessibility, then restart SnapText.",
        )
    }
    #[cfg(target_os = "windows")]
    {
        String::from(
            "UI Automation is used for focused text controls; elevated apps may need SnapText to run with matching privileges.",
        )
    }
    #[cfg(target_os = "linux")]
    {
        String::from(
            "Install wl-clipboard for Wayland or xclip/xsel for X11, and ensure the selected text is available in PRIMARY or CLIPBOARD.",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        String::from("SnapText only targets macOS, Windows, and Linux desktops.")
    }
}

fn ocr_models_capability_status(state: &AppState) -> String {
    match validate_ocr_models_inner(state) {
        Ok(status) if status.valid && status.loadable => String::from("ready"),
        Ok(status) if !status.missing_files.is_empty() => String::from("missing_models"),
        Ok(_) => String::from("unloadable_models"),
        Err(_) => String::from("error"),
    }
}

fn ocr_models_capability_action(state: &AppState) -> String {
    match validate_ocr_models_inner(state) {
        Ok(status) if status.valid && status.loadable => {
            format!("Local ONNX OCR is ready: {}", status.message)
        }
        Ok(status) if !status.missing_files.is_empty() => format!(
            "Install bundled OCR assets in {}: {}",
            status.model_dir,
            status.missing_files.join(", ")
        ),
        Ok(status) => status.message,
        Err(err) => format!("Validate local OCR models failed: {err}"),
    }
}
