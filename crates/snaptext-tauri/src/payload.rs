use std::io::Cursor;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageFormat, RgbaImage};
use snaptext_core::{Error, Result, screenshot::ImageMeta};

const MAX_IMAGE_PAYLOAD_BYTES: usize = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 24_000_000;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ScreenshotPayload {
    pub meta: ImageMeta,
    pub base64_png: String,
}

impl ScreenshotPayload {
    pub(crate) fn from_image(image: RgbaImage) -> Result<Self> {
        let width = image.width();
        let height = image.height();
        let mut png = Vec::new();
        DynamicImage::ImageRgba8(image).write_to(&mut Cursor::new(&mut png), ImageFormat::Png)?;

        Ok(Self {
            meta: ImageMeta {
                width,
                height,
                path: None,
            },
            base64_png: STANDARD.encode(png),
        })
    }
}

pub(crate) fn png_payload_to_image(base64_png: &str) -> Result<DynamicImage> {
    base64_image_to_dynamic_image(base64_png)
}

pub(crate) fn base64_image_to_dynamic_image(base64_image: &str) -> Result<DynamicImage> {
    let base64_image = image_payload_base64_segment(base64_image)?;
    if base64_image.is_empty() {
        return Err(Error::Image("image payload cannot be empty".to_owned()));
    }
    if base64_image.len() > max_base64_payload_chars() {
        return Err(Error::Image(format!(
            "image payload is too large. Use an image under {} bytes.",
            MAX_IMAGE_PAYLOAD_BYTES
        )));
    }

    let bytes = STANDARD
        .decode(base64_image)
        .map_err(|err| Error::Image(format!("image payload is not valid base64: {err}")))?;
    if bytes.is_empty() {
        return Err(Error::Image("image payload cannot be empty".to_owned()));
    }
    if bytes.len() > MAX_IMAGE_PAYLOAD_BYTES {
        return Err(Error::Image(format!(
            "image payload is too large: {} bytes. Use an image under {} bytes.",
            bytes.len(),
            MAX_IMAGE_PAYLOAD_BYTES
        )));
    }

    let format = image::guess_format(&bytes).map_err(|err| {
        Error::Image(format!("image payload format could not be detected: {err}"))
    })?;
    if !is_supported_image_format(format) {
        return Err(Error::Image(format!(
            "unsupported image format: {format:?}. Use PNG, JPEG, or WebP."
        )));
    }

    let image = image::load_from_memory(&bytes)?;
    validate_decoded_image_dimensions(&image)?;
    Ok(image)
}

pub(crate) fn is_supported_image_format(format: ImageFormat) -> bool {
    matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    )
}

pub(crate) fn max_base64_payload_chars() -> usize {
    MAX_IMAGE_PAYLOAD_BYTES.div_ceil(3) * 4
}

pub(crate) fn validate_decoded_image_dimensions(image: &DynamicImage) -> Result<()> {
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Image("image cannot be empty".to_owned()));
    }
    let pixels = u64::from(image.width()) * u64::from(image.height());
    if pixels > MAX_IMAGE_PIXELS {
        return Err(Error::Image(format!(
            "image is too large: {}x{} pixels. Crop or resize below {} pixels.",
            image.width(),
            image.height(),
            MAX_IMAGE_PIXELS
        )));
    }
    Ok(())
}

pub(crate) fn image_payload_base64_segment(payload: &str) -> Result<&str> {
    let payload = payload.trim();
    if payload.is_empty() {
        return Err(Error::Image("image payload cannot be empty".to_owned()));
    }

    let Some(data_url) = payload.strip_prefix("data:") else {
        return Ok(payload);
    };
    let (metadata, base64_payload) = data_url
        .split_once(',')
        .ok_or_else(|| Error::Image("image data URL is missing base64 payload".to_owned()))?;
    validate_image_data_url_metadata(metadata)?;

    Ok(base64_payload.trim())
}

pub(crate) fn validate_image_data_url_metadata(metadata: &str) -> Result<()> {
    let mut parts = metadata.split(';').map(str::trim);
    let media_type = parts.next().unwrap_or_default();
    if !is_supported_image_data_url_media_type(media_type) {
        return Err(Error::Image(format!(
            "image data URL media type `{media_type}` is not supported. Use image/png, image/jpeg, or image/webp."
        )));
    }
    if !parts.any(|part| part.eq_ignore_ascii_case("base64")) {
        return Err(Error::Image(
            "image data URL must be base64 encoded".to_owned(),
        ));
    }

    Ok(())
}

pub(crate) fn is_supported_image_data_url_media_type(media_type: &str) -> bool {
    matches!(
        media_type.to_ascii_lowercase().as_str(),
        "image/png" | "image/jpeg" | "image/webp"
    )
}

pub(crate) fn crop_image(
    image: &DynamicImage,
    bbox: snaptext_core::ocr::BBox,
) -> Result<DynamicImage> {
    if bbox.width == 0 || bbox.height == 0 {
        return Err(Error::Image("capture region cannot be empty".to_owned()));
    }

    let image_width = image.width();
    let image_height = image.height();
    if bbox.x >= image_width || bbox.y >= image_height {
        return Err(Error::Image(
            "capture region is outside the screenshot".to_owned(),
        ));
    }

    let width = bbox.width.min(image_width.saturating_sub(bbox.x)).max(1);
    let height = bbox.height.min(image_height.saturating_sub(bbox.y)).max(1);
    Ok(image.crop_imm(bbox.x, bbox.y, width, height))
}
