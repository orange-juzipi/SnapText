#[cfg(target_os = "macos")]
use image::DynamicImage;
#[cfg(target_os = "macos")]
use snaptext_core::Error;
use snaptext_core::Result;

use crate::{AppState, ScreenshotPayload};

pub(crate) async fn screenshot_full_inner(state: &AppState) -> Result<ScreenshotPayload> {
    let image = state.screencap.capture_full_screen().await?;
    ScreenshotPayload::from_image(image)
}

/// Captures the monitor under the cursor using virtual-desktop coordinates.
#[cfg(not(target_os = "macos"))]
pub(crate) async fn screenshot_full_inner_at(
    state: &AppState,
    point: Option<(i32, i32)>,
) -> Result<ScreenshotPayload> {
    let image = state.screencap.capture_full_screen_at(point).await?;
    ScreenshotPayload::from_image(image)
}

pub(crate) async fn screenshot_region_inner(
    state: &AppState,
    bbox: snaptext_core::ocr::BBox,
) -> Result<ScreenshotPayload> {
    let image = state.screencap.capture_region(bbox).await?;
    ScreenshotPayload::from_image(image)
}

#[cfg(target_os = "macos")]
pub(crate) fn payload_to_full_region(payload: &ScreenshotPayload) -> snaptext_core::ocr::BBox {
    snaptext_core::ocr::BBox {
        x: 0,
        y: 0,
        width: payload.meta.width,
        height: payload.meta.height,
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn capture_macos_interactive_screenshot() -> Result<(ScreenshotPayload, DynamicImage)> {
    let tempdir = tempfile::tempdir()?;
    let image_path = tempdir.path().join("snaptext-native-selection.png");
    let output = std::process::Command::new("screencapture")
        .arg("-i")
        .arg("-s")
        .arg("-Jselection")
        .arg("-x")
        .arg("-tpng")
        .arg(&image_path)
        .output()
        .map_err(|err| Error::Image(format!("failed to start macOS screenshot selector: {err}")))?;

    if !output.status.success() || !image_path.is_file() {
        return Err(Error::Image(mac_screenshot_selection_error(
            output.status.code(),
            &output.stderr,
        )));
    }

    let image = image::open(&image_path)
        .map_err(|err| Error::Image(format!("failed to read selected screenshot: {err}")))?;
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Image("selected screenshot is empty".to_owned()));
    }

    // The UI still receives a payload for preview/history consistency, while
    // the backend uses the same selected pixels for OCR and translation.
    let payload = ScreenshotPayload::from_image(image.to_rgba8())?;
    Ok((payload, image))
}

#[cfg(target_os = "macos")]
pub(crate) fn mac_screenshot_selection_error(status_code: Option<i32>, stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_owned();
    if message.is_empty() {
        return format!(
            "screenshot selection produced no image; status={}",
            status_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "terminated".to_owned())
        );
    }
    format!("screenshot selection failed: {message}")
}
