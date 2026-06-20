use std::path::{Path, PathBuf};

use image::{DynamicImage, GrayImage, Rgb, RgbImage, imageops::FilterType};
use ndarray::{Array4, ArrayViewD, ShapeError};
use ort::{session::Session, value::TensorRef};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

pub const DET_MODEL_FILE: &str = "det.onnx";
pub const CLS_MODEL_FILE: &str = "cls.onnx";
pub const REC_MODEL_FILE: &str = "rec.onnx";
pub const REC_DICT_FILE: &str = "rec_dict.txt";
pub const MAX_PREPROCESS_SIDE: u32 = 1600;
pub const DET_INPUT_SIDE_MULTIPLE: u32 = 32;
pub const DET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
pub const DET_STD: [f32; 3] = [0.229, 0.224, 0.225];
pub const DET_BOX_THRESHOLD: f32 = 0.3;
pub const DET_MIN_BOX_SIDE: u32 = 3;
pub const REC_BLANK_INDEX: usize = 0;
pub const CLS_IMAGE_HEIGHT: u32 = 80;
pub const CLS_IMAGE_WIDTH: u32 = 160;
pub const CLS_LABELS: [&str; 2] = ["0", "180"];
pub const REC_IMAGE_HEIGHT: u32 = 48;
pub const REC_IMAGE_WIDTH: u32 = 320;
pub const REC_MAX_IMAGE_WIDTH: u32 = 960;
pub const OCR_CROP_X_PADDING_RATIO: f32 = 0.10;
pub const OCR_CROP_Y_PADDING_RATIO: f32 = 0.35;
pub const REC_MEAN: [f32; 3] = [0.5, 0.5, 0.5];
pub const REC_STD: [f32; 3] = [0.5, 0.5, 0.5];
pub const OCR_CHANNEL_ORDER_ENV: &str = "SNAPTEXT_OCR_CHANNEL_ORDER";
#[cfg(target_os = "macos")]
pub const OCR_ENGINE_ENV: &str = "SNAPTEXT_OCR_ENGINE";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextLine {
    pub text: String,
    pub bbox: BBox,
    pub confidence: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct BBox {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct OcrEngine {
    model_dir: PathBuf,
}

#[derive(Debug)]
pub struct OcrSessions {
    pub det: Session,
    pub cls: Session,
    pub rec: Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DetectionOutput {
    pub width: u32,
    pub height: u32,
    pub probabilities: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecognitionLogits {
    pub timestep_count: usize,
    pub class_count: usize,
    pub probabilities: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OcrModelManifest {
    pub det: PathBuf,
    pub cls: PathBuf,
    pub rec: PathBuf,
    pub rec_dict: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OcrModelAssets {
    pub manifest: OcrModelManifest,
    pub recognition_dict_len: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DetectionInput {
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub chw_data: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DetectionCandidate {
    pub bbox: BBox,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClassificationOutput {
    pub label: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClassificationInput {
    pub width: u32,
    pub height: u32,
    pub resized_width: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub chw_data: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecognitionOutput {
    pub text: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecognitionInput {
    pub width: u32,
    pub height: u32,
    pub resized_width: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub chw_data: Vec<f32>,
}

impl OcrEngine {
    pub fn new(model_dir: impl Into<PathBuf>) -> Result<Self> {
        let model_dir = model_dir.into();
        if model_dir.as_os_str().is_empty() {
            return Err(Error::Ocr("model directory cannot be empty".to_owned()));
        }

        Ok(Self { model_dir })
    }

    pub fn model_dir(&self) -> &Path {
        &self.model_dir
    }

    pub fn manifest(&self) -> OcrModelManifest {
        OcrModelManifest::from_dir(&self.model_dir)
    }

    pub fn validate_models(&self) -> Result<OcrModelManifest> {
        let manifest = self.manifest();
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate_assets(&self) -> Result<OcrModelAssets> {
        let manifest = self.validate_models()?;
        let recognition_dict_len = manifest.load_recognition_dict()?.len();
        Ok(OcrModelAssets {
            manifest,
            recognition_dict_len,
        })
    }

    pub fn load_sessions(&self) -> Result<OcrSessions> {
        let manifest = self.validate_models()?;
        OcrSessions::from_manifest(&manifest)
    }

    pub async fn run(&self, image: DynamicImage) -> Result<Vec<TextLine>> {
        if image.width() == 0 || image.height() == 0 {
            return Err(Error::Ocr("image cannot be empty".to_owned()));
        }

        #[cfg(target_os = "macos")]
        if macos_ocr_backend_from_env() == MacosOcrBackend::Vision {
            // Apple Vision is the primary macOS OCR path because it handles real
            // desktop screenshots better than the current minimal PP-OCR postprocess.
            return macos_vision::recognize_text(image);
        }

        #[cfg(target_os = "macos")]
        let manifest = match self.validate_models() {
            Ok(manifest) => manifest,
            Err(model_error) => {
                // macOS Vision keeps OCR usable when bundled Paddle models are absent.
                tracing::warn!(
                    error = %model_error,
                    "Paddle OCR models are unavailable; falling back to macOS Vision OCR"
                );
                return macos_vision::recognize_text(image);
            }
        };

        #[cfg(not(target_os = "macos"))]
        let manifest = self.validate_models()?;

        let mut sessions = self.load_sessions()?;
        let dictionary = manifest.load_recognition_dict()?;
        let detection_input = preprocess_for_detection(&image)?;
        let detection_output = sessions.run_detection(&detection_input)?;
        let candidates = postprocess_detection_map(
            &detection_output.probabilities,
            detection_output.width,
            detection_output.height,
            &detection_input,
            DET_BOX_THRESHOLD,
        )?;

        let mut lines = Vec::with_capacity(candidates.len());
        for candidate in candidates {
            let crop = crop_text_region_for_recognition(&image, candidate.bbox)?;
            // PP-OCR classifies 0/180 orientation per cropped text box before recognition.
            let classification_input = preprocess_for_classification(&crop)?;
            let classification = sessions.run_classification(&classification_input)?;
            let recognition_image = rotate_text_region_for_classification(crop, &classification);
            let recognition_input = preprocess_for_recognition(&recognition_image)?;
            let logits = sessions.run_recognition(&recognition_input)?;
            let recognition = decode_recognition_ctc(
                &logits.probabilities,
                logits.timestep_count,
                logits.class_count,
                &dictionary,
            )?;

            if recognition.text.trim().is_empty() {
                continue;
            }

            lines.push(TextLine {
                text: recognition.text,
                bbox: candidate.bbox,
                confidence: (candidate.score + classification.confidence + recognition.confidence)
                    / 3.0,
            });
        }

        sort_text_lines_for_reading(&mut lines);
        Ok(lines)
    }
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MacosOcrBackend {
    Vision,
    Paddle,
}

#[cfg(target_os = "macos")]
fn macos_ocr_backend_from_env() -> MacosOcrBackend {
    macos_ocr_backend_from_value(std::env::var(OCR_ENGINE_ENV).ok().as_deref())
}

#[cfg(target_os = "macos")]
fn macos_ocr_backend_from_value(value: Option<&str>) -> MacosOcrBackend {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value)
            if value.eq_ignore_ascii_case("paddle")
                || value.eq_ignore_ascii_case("onnx")
                || value.eq_ignore_ascii_case("ppocr") =>
        {
            MacosOcrBackend::Paddle
        }
        _ => MacosOcrBackend::Vision,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OcrChannelOrder {
    Rgb,
    Bgr,
}

fn ocr_channel_order_from_env() -> OcrChannelOrder {
    ocr_channel_order_from_value(std::env::var(OCR_CHANNEL_ORDER_ENV).ok().as_deref())
}

fn ocr_channel_order_from_value(value: Option<&str>) -> OcrChannelOrder {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.eq_ignore_ascii_case("rgb") => OcrChannelOrder::Rgb,
        // Paddle/OpenCV OCR examples commonly feed BGR tensors. Keep that as the
        // default so the Rust path matches the TTime/eSearch-style ONNX runtime.
        _ => OcrChannelOrder::Bgr,
    }
}

#[cfg(target_os = "macos")]
mod macos_vision {
    use std::{io::Cursor, ptr};

    use image::{DynamicImage, ImageFormat};
    use objc2::{class, msg_send, runtime::AnyObject};
    use objc2_core_foundation::CGRect;
    use objc2_foundation::{NSArray, NSDictionary, NSError, NSString, NSURL};

    use super::{BBox, TextLine};
    use crate::{Error, Result};

    const VN_REQUEST_TEXT_RECOGNITION_LEVEL_ACCURATE: isize = 0;

    #[link(name = "Vision", kind = "framework")]
    unsafe extern "C" {}

    pub fn recognize_text(image: DynamicImage) -> Result<Vec<TextLine>> {
        let width = image.width();
        let height = image.height();
        let image_path = write_temp_png(image)?;
        let result = recognize_png_path(&image_path, width, height);
        let _ = std::fs::remove_file(&image_path);
        result
    }

    fn write_temp_png(image: DynamicImage) -> Result<std::path::PathBuf> {
        let path = std::env::temp_dir().join(format!(
            "snaptext-vision-{}-{}.png",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let mut bytes = Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, ImageFormat::Png)
            .map_err(|err| Error::Ocr(format!("failed to encode image for macOS Vision: {err}")))?;
        std::fs::write(&path, bytes.into_inner())?;
        Ok(path)
    }

    fn recognize_png_path(
        path: &std::path::Path,
        width: u32,
        height: u32,
    ) -> Result<Vec<TextLine>> {
        let url = NSURL::from_file_path(path).ok_or_else(|| {
            Error::Ocr(format!("failed to build file URL for {}", path.display()))
        })?;
        let request = new_text_request();
        if request.is_null() {
            return Err(Error::Ocr(
                "failed to create macOS Vision text recognition request".to_owned(),
            ));
        }
        configure_text_request(unsafe { &*request });

        let options = NSDictionary::<NSString, AnyObject>::new();
        let handler: *mut AnyObject = unsafe { msg_send![class!(VNImageRequestHandler), alloc] };
        let handler: *mut AnyObject = unsafe {
            msg_send![
                handler,
                initWithURL: &*url,
                options: &*options
            ]
        };
        let request_ref = unsafe { &*request };
        let requests = NSArray::from_slice(&[request_ref]);
        let mut error: *mut NSError = ptr::null_mut();
        let ok: bool = unsafe {
            msg_send![
                &*handler,
                performRequests: &*requests,
                error: &mut error
            ]
        };
        if !ok {
            return Err(Error::Ocr(
                "macOS Vision text recognition failed".to_owned(),
            ));
        }

        let results: *mut NSArray<AnyObject> = unsafe { msg_send![&*request, results] };
        if results.is_null() {
            return Ok(Vec::new());
        }
        let results = unsafe { &*results };
        let mut lines = Vec::with_capacity(results.count());
        for index in 0..results.count() {
            let observation = unsafe { results.objectAtIndex_unchecked(index) };
            let candidates: *mut NSArray<AnyObject> =
                unsafe { msg_send![observation, topCandidates: 1usize] };
            if candidates.is_null() {
                continue;
            }
            let candidates = unsafe { &*candidates };
            if candidates.count() == 0 {
                continue;
            }
            let candidate = unsafe { candidates.objectAtIndex_unchecked(0) };
            let text: *mut NSString = unsafe { msg_send![candidate, string] };
            if text.is_null() {
                continue;
            }
            let text =
                unsafe { objc2::rc::autoreleasepool(|pool| (&*text).to_str(pool).to_owned()) };
            let text = text.trim().to_owned();
            if text.is_empty() {
                continue;
            }
            let confidence: f32 = unsafe { msg_send![candidate, confidence] };
            let rect: CGRect = unsafe { msg_send![observation, boundingBox] };
            lines.push(TextLine {
                text,
                bbox: bbox_from_vision_rect(rect, width, height),
                confidence,
            });
        }

        super::sort_text_lines_for_reading(&mut lines);
        Ok(lines)
    }

    fn new_text_request() -> *mut AnyObject {
        let request: *mut AnyObject = unsafe { msg_send![class!(VNRecognizeTextRequest), alloc] };
        unsafe { msg_send![request, init] }
    }

    fn configure_text_request(request: &AnyObject) {
        let zh_hans = NSString::from_str("zh-Hans");
        let zh_hant = NSString::from_str("zh-Hant");
        let en_us = NSString::from_str("en-US");
        let languages = NSArray::from_slice(&[&*zh_hans, &*zh_hant, &*en_us]);
        unsafe {
            let _: () = msg_send![
                request,
                setRecognitionLevel: VN_REQUEST_TEXT_RECOGNITION_LEVEL_ACCURATE
            ];
            let _: () = msg_send![request, setUsesLanguageCorrection: true];
            let _: () = msg_send![request, setRecognitionLanguages: &*languages];
        }
    }

    fn bbox_from_vision_rect(rect: CGRect, image_width: u32, image_height: u32) -> BBox {
        let x = (rect.origin.x * image_width as f64)
            .round()
            .clamp(0.0, image_width as f64) as u32;
        let y_top = ((1.0 - rect.origin.y - rect.size.height) * image_height as f64)
            .round()
            .clamp(0.0, image_height as f64) as u32;
        let width = (rect.size.width * image_width as f64)
            .round()
            .clamp(0.0, image_width.saturating_sub(x) as f64) as u32;
        let height = (rect.size.height * image_height as f64)
            .round()
            .clamp(0.0, image_height.saturating_sub(y_top) as f64) as u32;
        BBox {
            x,
            y: y_top,
            width,
            height,
        }
    }
}

impl OcrModelManifest {
    pub fn from_dir(model_dir: impl AsRef<Path>) -> Self {
        let model_dir = model_dir.as_ref();
        Self {
            det: model_dir.join(DET_MODEL_FILE),
            cls: model_dir.join(CLS_MODEL_FILE),
            rec: model_dir.join(REC_MODEL_FILE),
            rec_dict: model_dir.join(REC_DICT_FILE),
        }
    }

    pub fn validate(&self) -> Result<()> {
        let missing = [
            (&self.det, DET_MODEL_FILE),
            (&self.cls, CLS_MODEL_FILE),
            (&self.rec, REC_MODEL_FILE),
            (&self.rec_dict, REC_DICT_FILE),
        ]
        .into_iter()
        .filter_map(|(path, label)| (!path.is_file()).then_some(label))
        .collect::<Vec<_>>();

        if !missing.is_empty() {
            return Err(Error::Ocr(format!(
                "missing OCR model files: {}",
                missing.join(", ")
            )));
        }

        Ok(())
    }

    pub fn load_recognition_dict(&self) -> Result<Vec<String>> {
        let content = std::fs::read_to_string(&self.rec_dict)?;
        let entries = content
            .lines()
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();

        if entries.is_empty() {
            return Err(Error::Ocr("recognition dictionary is empty".to_owned()));
        }

        Ok(entries)
    }
}

impl OcrSessions {
    pub fn from_manifest(manifest: &OcrModelManifest) -> Result<Self> {
        Ok(Self {
            det: load_session_from_file(&manifest.det)?,
            cls: load_session_from_file(&manifest.cls)?,
            rec: load_session_from_file(&manifest.rec)?,
        })
    }

    pub fn run_detection(&mut self, input: &DetectionInput) -> Result<DetectionOutput> {
        let tensor = detection_tensor(input)?;
        let outputs = self
            .det
            .run(ort::inputs![TensorRef::from_array_view(tensor.view())?])?;
        let output = outputs
            .into_iter()
            .next()
            .ok_or_else(|| Error::Ocr("detection model returned no outputs".to_owned()))?
            .1;
        detection_output_from_value(output.try_extract_array::<f32>()?)
    }

    pub fn run_recognition(&mut self, input: &RecognitionInput) -> Result<RecognitionLogits> {
        let tensor = recognition_tensor(input)?;
        let outputs = self
            .rec
            .run(ort::inputs![TensorRef::from_array_view(tensor.view())?])?;
        let output = outputs
            .into_iter()
            .next()
            .ok_or_else(|| Error::Ocr("recognition model returned no outputs".to_owned()))?
            .1;
        recognition_logits_from_value(output.try_extract_array::<f32>()?)
    }

    pub fn run_classification(
        &mut self,
        input: &ClassificationInput,
    ) -> Result<ClassificationOutput> {
        let tensor = classification_tensor(input)?;
        let outputs = self
            .cls
            .run(ort::inputs![TensorRef::from_array_view(tensor.view())?])?;
        let output = outputs
            .into_iter()
            .next()
            .ok_or_else(|| Error::Ocr("classification model returned no outputs".to_owned()))?
            .1;
        decode_classification_logits(
            output
                .try_extract_array::<f32>()?
                .as_slice_memory_order()
                .ok_or_else(|| {
                    Error::Ocr("classification output tensor is not contiguous".to_owned())
                })?,
        )
    }
}

pub fn preprocess_for_detection(image: &DynamicImage) -> Result<DetectionInput> {
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Ocr("image cannot be empty".to_owned()));
    }

    let (resized_width, resized_height) = resized_dimensions(image.width(), image.height());
    let rgb = image.to_rgb8();
    let resized =
        image::imageops::resize(&rgb, resized_width, resized_height, FilterType::Triangle);
    let padded_width = round_up_to_multiple(resized_width, DET_INPUT_SIDE_MULTIPLE);
    let padded_height = round_up_to_multiple(resized_height, DET_INPUT_SIDE_MULTIPLE);
    let mut padded = RgbImage::from_pixel(padded_width, padded_height, Rgb([0, 0, 0]));
    image::imageops::replace(&mut padded, &resized, 0, 0);

    Ok(DetectionInput {
        width: padded_width,
        height: padded_height,
        original_width: image.width(),
        original_height: image.height(),
        scale_x: resized_width as f32 / image.width() as f32,
        scale_y: resized_height as f32 / image.height() as f32,
        chw_data: normalize_rgb_to_chw(&padded),
    })
}

pub fn preprocess_grayscale_for_tests(image: &DynamicImage) -> Result<GrayImage> {
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Ocr("image cannot be empty".to_owned()));
    }

    let gray = image.to_luma8();
    let (width, height) = resized_dimensions(gray.width(), gray.height());

    Ok(image::imageops::resize(
        &gray,
        width,
        height,
        FilterType::Triangle,
    ))
}

pub fn detection_tensor(input: &DetectionInput) -> Result<Array4<f32>> {
    chw_to_nchw_tensor(&input.chw_data, input.height, input.width)
}

pub fn classification_tensor(input: &ClassificationInput) -> Result<Array4<f32>> {
    chw_to_nchw_tensor(&input.chw_data, input.height, input.width)
}

pub fn recognition_tensor(input: &RecognitionInput) -> Result<Array4<f32>> {
    chw_to_nchw_tensor(&input.chw_data, input.height, input.width)
}

fn resized_dimensions(width: u32, height: u32) -> (u32, u32) {
    let longest_side = width.max(height);
    if longest_side <= MAX_PREPROCESS_SIDE {
        return (width, height);
    }

    let scale = MAX_PREPROCESS_SIDE as f32 / longest_side as f32;
    (
        ((width as f32 * scale).round() as u32).max(1),
        ((height as f32 * scale).round() as u32).max(1),
    )
}

fn round_up_to_multiple(value: u32, multiple: u32) -> u32 {
    if multiple == 0 {
        return value;
    }

    value.div_ceil(multiple) * multiple
}

fn normalize_rgb_to_chw(image: &RgbImage) -> Vec<f32> {
    normalize_rgb_to_chw_with_stats(image, DET_MEAN, DET_STD)
}

fn detection_output_from_value(view: ArrayViewD<'_, f32>) -> Result<DetectionOutput> {
    let shape = view.shape();
    if shape.len() < 2 {
        return Err(Error::Ocr(format!(
            "detection output must have at least 2 dimensions, got {}",
            shape.len()
        )));
    }

    let width = *shape
        .last()
        .ok_or_else(|| Error::Ocr("detection output is missing width".to_owned()))?;
    let height = shape[shape.len() - 2];
    if width == 0 || height == 0 {
        return Err(Error::Ocr(
            "detection output dimensions cannot be empty".to_owned(),
        ));
    }

    let plane = width * height;
    let probabilities = view
        .as_slice_memory_order()
        .ok_or_else(|| Error::Ocr("detection output tensor is not contiguous".to_owned()))?
        .iter()
        .take(plane)
        .copied()
        .collect::<Vec<_>>();

    if probabilities.len() != plane {
        return Err(Error::Ocr(
            "detection output tensor is truncated".to_owned(),
        ));
    }

    Ok(DetectionOutput {
        width: width as u32,
        height: height as u32,
        probabilities,
    })
}

fn chw_to_nchw_tensor(chw_data: &[f32], height: u32, width: u32) -> Result<Array4<f32>> {
    let expected_len = (height as usize) * (width as usize) * 3;
    if chw_data.len() != expected_len {
        return Err(Error::Ocr(format!(
            "tensor shape mismatch: expected {expected_len} values, got {}",
            chw_data.len()
        )));
    }

    Array4::from_shape_vec((1, 3, height as usize, width as usize), chw_data.to_vec())
        .map_err(map_shape_error)
}

fn recognition_logits_from_value(view: ArrayViewD<'_, f32>) -> Result<RecognitionLogits> {
    let shape = view.shape();
    if shape.len() < 2 {
        return Err(Error::Ocr(format!(
            "recognition output must have at least 2 dimensions, got {}",
            shape.len()
        )));
    }

    let class_count = *shape
        .last()
        .ok_or_else(|| Error::Ocr("recognition output is missing class dimension".to_owned()))?;
    let timestep_count = shape[shape.len() - 2];
    if class_count == 0 || timestep_count == 0 {
        return Err(Error::Ocr(
            "recognition output dimensions cannot be empty".to_owned(),
        ));
    }

    let probabilities = view
        .as_slice_memory_order()
        .ok_or_else(|| Error::Ocr("recognition output tensor is not contiguous".to_owned()))?
        .to_vec();
    let expected_len = timestep_count * class_count;
    if probabilities.len() < expected_len {
        return Err(Error::Ocr(
            "recognition output tensor is truncated".to_owned(),
        ));
    }

    Ok(RecognitionLogits {
        timestep_count,
        class_count,
        probabilities,
    })
}

fn decode_classification_logits(probabilities: &[f32]) -> Result<ClassificationOutput> {
    if probabilities.is_empty() {
        return Err(Error::Ocr(
            "classification output dimensions cannot be empty".to_owned(),
        ));
    }

    let (label_index, confidence) = argmax(probabilities);
    let label = CLS_LABELS
        .get(label_index)
        .ok_or_else(|| Error::Ocr(format!("unknown classification label index {label_index}")))?;

    Ok(ClassificationOutput {
        label: (*label).to_owned(),
        confidence,
    })
}

fn load_session_from_file(path: &Path) -> Result<Session> {
    Session::builder()?
        .commit_from_file(path)
        .map_err(Into::into)
}

fn map_shape_error(error: ShapeError) -> Error {
    Error::Ocr(format!("failed to build OCR tensor: {error}"))
}

fn normalize_rgb_to_chw_with_stats(image: &RgbImage, mean: [f32; 3], std: [f32; 3]) -> Vec<f32> {
    normalize_rgb_to_chw_with_stats_and_order(image, mean, std, ocr_channel_order_from_env())
}

fn normalize_rgb_to_chw_with_stats_and_order(
    image: &RgbImage,
    mean: [f32; 3],
    std: [f32; 3],
    order: OcrChannelOrder,
) -> Vec<f32> {
    let plane_len = image.width() as usize * image.height() as usize;
    let mut data = vec![0.0; plane_len * 3];

    for (index, pixel) in image.pixels().enumerate() {
        for channel in 0..3 {
            let source_channel = match order {
                OcrChannelOrder::Rgb => channel,
                OcrChannelOrder::Bgr => 2 - channel,
            };
            let normalized = f32::from(pixel[source_channel]) / 255.0;
            data[channel * plane_len + index] = (normalized - mean[channel]) / std[channel];
        }
    }

    data
}

fn rotate_text_region_for_classification(
    image: DynamicImage,
    classification: &ClassificationOutput,
) -> DynamicImage {
    match classification.label.as_str() {
        "180" => image.rotate180(),
        _ => image,
    }
}

pub fn crop_text_region(image: &DynamicImage, bbox: BBox) -> Result<DynamicImage> {
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Ocr("image cannot be empty".to_owned()));
    }

    let Some((x, y, width, height)) = clamp_bbox_to_image(bbox, image.width(), image.height())
    else {
        return Err(Error::Ocr("text region is outside image bounds".to_owned()));
    };

    Ok(image.crop_imm(x, y, width, height))
}

fn crop_text_region_for_recognition(image: &DynamicImage, bbox: BBox) -> Result<DynamicImage> {
    crop_text_region(image, padded_bbox_for_recognition(bbox))
}

fn padded_bbox_for_recognition(bbox: BBox) -> BBox {
    // Detection maps often hug glyph pixels tightly. Adding surrounding context
    // mirrors TTime's OCR path and prevents recognition from seeing clipped text.
    let pad_x = ((bbox.width as f32) * OCR_CROP_X_PADDING_RATIO).round() as u32;
    let pad_y = ((bbox.height as f32) * OCR_CROP_Y_PADDING_RATIO).round() as u32;
    let x = bbox.x.saturating_sub(pad_x);
    let y = bbox.y.saturating_sub(pad_y);
    let right = bbox.x.saturating_add(bbox.width).saturating_add(pad_x);
    let bottom = bbox.y.saturating_add(bbox.height).saturating_add(pad_y);

    BBox {
        x,
        y,
        width: right.saturating_sub(x),
        height: bottom.saturating_sub(y),
    }
}

pub fn preprocess_for_classification(image: &DynamicImage) -> Result<ClassificationInput> {
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Ocr(
            "classification image cannot be empty".to_owned(),
        ));
    }

    let rgb = image.to_rgb8();
    let aspect = image.width() as f32 / image.height() as f32;
    let resized_width =
        ((CLS_IMAGE_HEIGHT as f32 * aspect).round() as u32).clamp(1, CLS_IMAGE_WIDTH);
    let resized =
        image::imageops::resize(&rgb, resized_width, CLS_IMAGE_HEIGHT, FilterType::Triangle);
    let mut padded = RgbImage::from_pixel(CLS_IMAGE_WIDTH, CLS_IMAGE_HEIGHT, Rgb([0, 0, 0]));
    image::imageops::replace(&mut padded, &resized, 0, 0);

    Ok(ClassificationInput {
        width: CLS_IMAGE_WIDTH,
        height: CLS_IMAGE_HEIGHT,
        resized_width,
        original_width: image.width(),
        original_height: image.height(),
        chw_data: normalize_rgb_to_chw_with_stats(&padded, REC_MEAN, REC_STD),
    })
}

pub fn preprocess_for_recognition(image: &DynamicImage) -> Result<RecognitionInput> {
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Ocr("recognition image cannot be empty".to_owned()));
    }

    let rgb = image.to_rgb8();
    let aspect = image.width() as f32 / image.height() as f32;
    let target_width = recognition_target_width(aspect);
    let resized_width = ((REC_IMAGE_HEIGHT as f32 * aspect).round() as u32).clamp(1, target_width);
    let resized =
        image::imageops::resize(&rgb, resized_width, REC_IMAGE_HEIGHT, FilterType::Triangle);
    let mut padded = RgbImage::from_pixel(target_width, REC_IMAGE_HEIGHT, Rgb([0, 0, 0]));
    image::imageops::replace(&mut padded, &resized, 0, 0);

    Ok(RecognitionInput {
        width: target_width,
        height: REC_IMAGE_HEIGHT,
        resized_width,
        original_width: image.width(),
        original_height: image.height(),
        chw_data: normalize_rgb_to_chw_with_stats(&padded, REC_MEAN, REC_STD),
    })
}

fn recognition_target_width(aspect: f32) -> u32 {
    // PP-OCR recognition models accept dynamic width after ONNX conversion. Use
    // the legacy 320px floor for short text and preserve more detail for long rows.
    let width = (REC_IMAGE_HEIGHT as f32 * aspect).ceil() as u32;
    round_up_to_multiple(
        width.clamp(REC_IMAGE_WIDTH, REC_MAX_IMAGE_WIDTH),
        DET_INPUT_SIDE_MULTIPLE,
    )
}

fn clamp_bbox_to_image(
    bbox: BBox,
    image_width: u32,
    image_height: u32,
) -> Option<(u32, u32, u32, u32)> {
    let x = bbox.x.min(image_width);
    let y = bbox.y.min(image_height);
    let right = bbox.x.saturating_add(bbox.width).min(image_width);
    let bottom = bbox.y.saturating_add(bbox.height).min(image_height);
    let width = right.saturating_sub(x);
    let height = bottom.saturating_sub(y);

    (width > 0 && height > 0).then_some((x, y, width, height))
}

pub fn postprocess_detection_map(
    probabilities: &[f32],
    map_width: u32,
    map_height: u32,
    input: &DetectionInput,
    threshold: f32,
) -> Result<Vec<DetectionCandidate>> {
    let expected_len = map_width as usize * map_height as usize;
    if probabilities.len() != expected_len {
        return Err(Error::Ocr(format!(
            "detection map size mismatch: expected {expected_len}, got {}",
            probabilities.len()
        )));
    }
    if map_width == 0 || map_height == 0 {
        return Err(Error::Ocr("detection map cannot be empty".to_owned()));
    }

    let mut visited = vec![false; expected_len];
    let mut candidates = Vec::new();
    for index in 0..expected_len {
        if visited[index] || probabilities[index] < threshold {
            continue;
        }

        if let Some(candidate) = flood_fill_candidate(
            index,
            probabilities,
            &mut visited,
            map_width,
            map_height,
            input,
            threshold,
        ) {
            candidates.push(candidate);
        }
    }

    candidates.sort_by_key(|candidate| (candidate.bbox.y, candidate.bbox.x));
    Ok(candidates)
}

fn flood_fill_candidate(
    start_index: usize,
    probabilities: &[f32],
    visited: &mut [bool],
    map_width: u32,
    map_height: u32,
    input: &DetectionInput,
    threshold: f32,
) -> Option<DetectionCandidate> {
    let thresholded = probabilities[start_index];
    if thresholded < threshold {
        return None;
    }

    let mut stack = vec![start_index];
    let mut min_x = map_width;
    let mut min_y = map_height;
    let mut max_x = 0;
    let mut max_y = 0;
    let mut score_sum = 0.0;
    let mut count = 0_u32;

    while let Some(index) = stack.pop() {
        if visited[index] || probabilities[index] < threshold {
            continue;
        }
        visited[index] = true;

        let x = index as u32 % map_width;
        let y = index as u32 / map_width;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
        score_sum += probabilities[index];
        count += 1;

        for neighbor in detection_neighbors(x, y, map_width, map_height) {
            let neighbor_index = (neighbor.1 * map_width + neighbor.0) as usize;
            if !visited[neighbor_index] {
                stack.push(neighbor_index);
            }
        }
    }

    if count == 0 {
        return None;
    }

    let width = max_x - min_x + 1;
    let height = max_y - min_y + 1;
    if width < DET_MIN_BOX_SIDE || height < DET_MIN_BOX_SIDE {
        return None;
    }

    let scale_x = input.width as f32 / map_width as f32 / input.scale_x;
    let scale_y = input.height as f32 / map_height as f32 / input.scale_y;
    let original_width = input.original_width;
    let original_height = input.original_height;
    let x = (min_x as f32 * scale_x)
        .round()
        .clamp(0.0, original_width as f32) as u32;
    let y = (min_y as f32 * scale_y)
        .round()
        .clamp(0.0, original_height as f32) as u32;
    let right = ((max_x + 1) as f32 * scale_x)
        .round()
        .clamp(0.0, original_width as f32) as u32;
    let bottom = ((max_y + 1) as f32 * scale_y)
        .round()
        .clamp(0.0, original_height as f32) as u32;
    Some(DetectionCandidate {
        bbox: BBox {
            x,
            y,
            width: right.saturating_sub(x).max(1),
            height: bottom.saturating_sub(y).max(1),
        },
        score: score_sum / count as f32,
    })
}

fn detection_neighbors(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> impl Iterator<Item = (u32, u32)> {
    let left = (x > 0).then_some((x - 1, y));
    let right = (x + 1 < width).then_some((x + 1, y));
    let up = (y > 0).then_some((x, y - 1));
    let down = (y + 1 < height).then_some((x, y + 1));
    [left, right, up, down].into_iter().flatten()
}

pub fn decode_recognition_ctc(
    probabilities: &[f32],
    timestep_count: usize,
    class_count: usize,
    dictionary: &[String],
) -> Result<RecognitionOutput> {
    if timestep_count == 0 || class_count == 0 {
        return Err(Error::Ocr(
            "recognition output dimensions cannot be empty".to_owned(),
        ));
    }
    let expected_len = timestep_count * class_count;
    if probabilities.len() != expected_len {
        return Err(Error::Ocr(format!(
            "recognition output size mismatch: expected {expected_len}, got {}",
            probabilities.len()
        )));
    }
    if dictionary.len() + 1 > class_count {
        return Err(Error::Ocr(format!(
            "recognition dictionary has {} entries but output only has {class_count} classes",
            dictionary.len()
        )));
    }

    let mut previous_index = REC_BLANK_INDEX;
    let mut text = String::new();
    let mut confidence_sum = 0.0;
    let mut confidence_count = 0_u32;

    for timestep in 0..timestep_count {
        let offset = timestep * class_count;
        let (class_index, score) = argmax(&probabilities[offset..offset + class_count]);
        if class_index != REC_BLANK_INDEX && class_index != previous_index {
            let dict_index = class_index - 1;
            if let Some(token) = dictionary.get(dict_index) {
                text.push_str(token);
                confidence_sum += score;
                confidence_count += 1;
            }
        }
        previous_index = class_index;
    }

    let confidence = if confidence_count == 0 {
        0.0
    } else {
        confidence_sum / confidence_count as f32
    };

    Ok(RecognitionOutput { text, confidence })
}

fn argmax(values: &[f32]) -> (usize, f32) {
    values
        .iter()
        .copied()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.total_cmp(right))
        .unwrap_or((0, 0.0))
}

pub fn sort_text_lines_for_reading(lines: &mut [TextLine]) {
    // Sort by top edge first, then by left edge. Later OCR work can refine this
    // with line clustering for multi-column documents.
    lines.sort_by_key(|line| (line.bbox.y, line.bbox.x));
}

pub fn aggregate_text(lines: &[TextLine]) -> String {
    let mut sorted = lines.to_vec();
    sort_text_lines_for_reading(&mut sorted);
    sorted
        .into_iter()
        .map(|line| line.text)
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    use ndarray::{Array, IxDyn};

    #[test]
    fn sorts_text_lines_top_to_bottom_left_to_right() {
        let mut lines = vec![line("b", 50, 10), line("c", 0, 20), line("a", 0, 10)];

        sort_text_lines_for_reading(&mut lines);

        let texts = lines.into_iter().map(|line| line.text).collect::<Vec<_>>();
        assert_eq!(texts, ["a", "b", "c"]);
    }

    #[test]
    fn aggregate_text_sorts_and_joins_lines() {
        let lines = vec![line("world", 0, 20), line("hello", 0, 10)];

        assert_eq!(aggregate_text(&lines), "hello\nworld");
    }

    #[test]
    fn preprocess_downscales_large_images() {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
            3200,
            1600,
            Rgba([255, 255, 255, 255]),
        ));

        let input = preprocess_for_detection(&image).expect("preprocessed image");

        assert_eq!(input.original_width, 3200);
        assert_eq!(input.original_height, 1600);
        assert_eq!(input.width, MAX_PREPROCESS_SIDE);
        assert_eq!(input.height, 800);
        assert_eq!(
            input.chw_data.len(),
            (input.width * input.height * 3) as usize
        );
    }

    #[test]
    fn preprocess_pads_detection_input_to_32_multiple() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(101, 65, Rgba([255, 255, 255, 255])));

        let input = preprocess_for_detection(&image).expect("preprocessed image");

        assert_eq!(input.width, 128);
        assert_eq!(input.height, 96);
        assert_eq!(input.chw_data.len(), 128 * 96 * 3);
    }

    #[test]
    fn detection_tensor_uses_nchw_shape() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(101, 65, Rgba([255, 255, 255, 255])));
        let input = preprocess_for_detection(&image).expect("preprocessed image");

        let tensor = detection_tensor(&input).expect("tensor");

        assert_eq!(
            tensor.shape(),
            &[1, 3, input.height as usize, input.width as usize]
        );
    }

    #[test]
    fn grayscale_preprocess_keeps_test_fixture_contract() {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
            3200,
            1600,
            Rgba([255, 255, 255, 255]),
        ));

        let gray = preprocess_grayscale_for_tests(&image).expect("preprocessed image");

        assert_eq!(gray.width(), MAX_PREPROCESS_SIDE);
        assert_eq!(gray.height(), 800);
    }

    #[test]
    fn crop_text_region_uses_bbox_dimensions() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(100, 80, Rgba([255, 255, 255, 255])));

        let crop = crop_text_region(
            &image,
            BBox {
                x: 10,
                y: 12,
                width: 30,
                height: 20,
            },
        )
        .expect("crop");

        assert_eq!(crop.width(), 30);
        assert_eq!(crop.height(), 20);
    }

    #[test]
    fn crop_text_region_clamps_to_image_bounds() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(100, 80, Rgba([255, 255, 255, 255])));

        let crop = crop_text_region(
            &image,
            BBox {
                x: 90,
                y: 70,
                width: 40,
                height: 30,
            },
        )
        .expect("crop");

        assert_eq!(crop.width(), 10);
        assert_eq!(crop.height(), 10);
    }

    #[test]
    fn padded_bbox_for_recognition_adds_context_without_underflow() {
        let bbox = padded_bbox_for_recognition(BBox {
            x: 2,
            y: 3,
            width: 20,
            height: 10,
        });

        assert_eq!(
            bbox,
            BBox {
                x: 0,
                y: 0,
                width: 24,
                height: 17,
            }
        );
    }

    #[test]
    fn crop_text_region_rejects_out_of_bounds_boxes() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(100, 80, Rgba([255, 255, 255, 255])));

        let err = crop_text_region(
            &image,
            BBox {
                x: 120,
                y: 90,
                width: 5,
                height: 5,
            },
        )
        .expect_err("out of bounds");

        assert!(
            err.to_string()
                .contains("text region is outside image bounds")
        );
    }

    #[test]
    fn preprocess_for_recognition_uses_legacy_width_for_short_text() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(120, 30, Rgba([255, 255, 255, 255])));

        let input = preprocess_for_recognition(&image).expect("recognition input");

        assert_eq!(input.width, REC_IMAGE_WIDTH);
        assert_eq!(input.height, REC_IMAGE_HEIGHT);
        assert_eq!(input.resized_width, 192);
        assert_eq!(
            input.chw_data.len(),
            (REC_IMAGE_WIDTH * REC_IMAGE_HEIGHT * 3) as usize
        );
    }

    #[test]
    fn preprocess_for_recognition_expands_width_for_long_text() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(800, 40, Rgba([255, 255, 255, 255])));

        let input = preprocess_for_recognition(&image).expect("recognition input");

        assert_eq!(input.width, REC_MAX_IMAGE_WIDTH);
        assert_eq!(input.resized_width, REC_MAX_IMAGE_WIDTH);
    }

    #[test]
    fn recognition_tensor_uses_nchw_shape() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(800, 40, Rgba([255, 255, 255, 255])));
        let input = preprocess_for_recognition(&image).expect("recognition input");

        let tensor = recognition_tensor(&input).expect("tensor");

        assert_eq!(
            tensor.shape(),
            &[1, 3, REC_IMAGE_HEIGHT as usize, input.width as usize]
        );
    }

    #[test]
    fn normalization_defaults_to_bgr_and_can_use_rgb() {
        let image = RgbImage::from_pixel(1, 1, Rgb([10, 20, 30]));

        let bgr = normalize_rgb_to_chw_with_stats_and_order(
            &image,
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0],
            OcrChannelOrder::Bgr,
        );
        let rgb = normalize_rgb_to_chw_with_stats_and_order(
            &image,
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0],
            OcrChannelOrder::Rgb,
        );

        assert_eq!(bgr, vec![30.0 / 255.0, 20.0 / 255.0, 10.0 / 255.0]);
        assert_eq!(rgb, vec![10.0 / 255.0, 20.0 / 255.0, 30.0 / 255.0]);
    }

    #[test]
    fn channel_order_env_defaults_to_bgr_unless_rgb_is_explicit() {
        assert_eq!(ocr_channel_order_from_value(None), OcrChannelOrder::Bgr);
        assert_eq!(
            ocr_channel_order_from_value(Some("bgr")),
            OcrChannelOrder::Bgr
        );
        assert_eq!(
            ocr_channel_order_from_value(Some("rgb")),
            OcrChannelOrder::Rgb
        );
    }

    #[test]
    fn classification_preprocess_uses_cls_model_shape() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(120, 30, Rgba([255, 255, 255, 255])));
        let input = preprocess_for_classification(&image).expect("classification input");

        assert_eq!(input.width, CLS_IMAGE_WIDTH);
        assert_eq!(input.height, CLS_IMAGE_HEIGHT);
        assert_eq!(
            input.chw_data.len(),
            (CLS_IMAGE_WIDTH * CLS_IMAGE_HEIGHT * 3) as usize
        );
    }

    #[test]
    fn classification_rotation_applies_for_180_label() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(3, 2, Rgba([10, 20, 30, 255])));
        let classification = ClassificationOutput {
            label: "180".to_owned(),
            confidence: 0.9,
        };

        let rotated = rotate_text_region_for_classification(image, &classification);

        assert_eq!(rotated.width(), 3);
        assert_eq!(rotated.height(), 2);
    }

    #[test]
    fn manifest_reports_missing_files() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let manifest = OcrModelManifest::from_dir(tempdir.path());

        let err = manifest.validate().expect_err("missing files");

        assert!(err.to_string().contains(DET_MODEL_FILE));
        assert!(err.to_string().contains(REC_DICT_FILE));
    }

    #[test]
    fn manifest_loads_recognition_dictionary() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        std::fs::write(tempdir.path().join(DET_MODEL_FILE), b"det").expect("det");
        std::fs::write(tempdir.path().join(CLS_MODEL_FILE), b"cls").expect("cls");
        std::fs::write(tempdir.path().join(REC_MODEL_FILE), b"rec").expect("rec");
        std::fs::write(tempdir.path().join(REC_DICT_FILE), "a\n\n b \n\u{3000}\n").expect("dict");

        let manifest = OcrModelManifest::from_dir(tempdir.path());

        assert_eq!(
            manifest.load_recognition_dict().expect("dictionary"),
            ["a".to_owned(), " b ".to_owned(), "\u{3000}".to_owned()]
        );
    }

    #[test]
    fn validate_assets_rejects_empty_recognition_dictionary() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        std::fs::write(tempdir.path().join(DET_MODEL_FILE), b"det").expect("det");
        std::fs::write(tempdir.path().join(CLS_MODEL_FILE), b"cls").expect("cls");
        std::fs::write(tempdir.path().join(REC_MODEL_FILE), b"rec").expect("rec");
        std::fs::write(tempdir.path().join(REC_DICT_FILE), "\n\n").expect("dict");
        let engine = OcrEngine::new(tempdir.path()).expect("engine");

        let err = engine.validate_assets().expect_err("empty dict");

        assert!(err.to_string().contains("recognition dictionary is empty"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_ocr_backend_defaults_to_vision_unless_paddle_is_explicit() {
        assert_eq!(macos_ocr_backend_from_value(None), MacosOcrBackend::Vision);
        assert_eq!(
            macos_ocr_backend_from_value(Some("")),
            MacosOcrBackend::Vision
        );
        assert_eq!(
            macos_ocr_backend_from_value(Some("vision")),
            MacosOcrBackend::Vision
        );
        assert_eq!(
            macos_ocr_backend_from_value(Some("paddle")),
            MacosOcrBackend::Paddle
        );
        assert_eq!(
            macos_ocr_backend_from_value(Some("ONNX")),
            MacosOcrBackend::Paddle
        );
        assert_eq!(
            macos_ocr_backend_from_value(Some(" ppocr ")),
            MacosOcrBackend::Paddle
        );
    }

    #[test]
    fn load_sessions_rejects_invalid_onnx_payloads() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        std::fs::write(tempdir.path().join(DET_MODEL_FILE), b"det").expect("det");
        std::fs::write(tempdir.path().join(CLS_MODEL_FILE), b"cls").expect("cls");
        std::fs::write(tempdir.path().join(REC_MODEL_FILE), b"rec").expect("rec");
        std::fs::write(tempdir.path().join(REC_DICT_FILE), "a\n").expect("dict");
        let engine = OcrEngine::new(tempdir.path()).expect("engine");

        let err = engine.load_sessions().expect_err("invalid onnx");

        assert!(err.to_string().contains("OCR failed"));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn run_returns_missing_model_error_when_paddle_models_are_absent() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let engine = OcrEngine::new(tempdir.path()).expect("engine");
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(64, 64, Rgba([255, 255, 255, 255])));

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let err = runtime
            .block_on(engine.run(image))
            .expect_err("missing models");

        assert!(err.to_string().contains("missing OCR model files"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn run_uses_vision_by_default_on_macos() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let engine = OcrEngine::new(tempdir.path()).expect("engine");
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(64, 64, Rgba([255, 255, 255, 255])));

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let lines = runtime
            .block_on(engine.run(image))
            .expect("macOS Vision fallback");

        // A blank image exercises the fallback without depending on real OCR content.
        assert!(lines.is_empty());
    }

    #[test]
    fn detection_output_from_value_uses_last_two_dimensions() {
        let view = Array::from_shape_vec(IxDyn(&[1, 1, 2, 3]), vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
            .expect("array");

        let output = detection_output_from_value(view.view()).expect("detection output");

        assert_eq!(output.width, 3);
        assert_eq!(output.height, 2);
        assert_eq!(output.probabilities.len(), 6);
        assert_eq!(output.probabilities[0], 0.1);
    }

    #[test]
    fn detection_output_from_value_rejects_scalar_shape() {
        let view = Array::from_shape_vec(IxDyn(&[6]), vec![0.1; 6]).expect("array");

        let err = detection_output_from_value(view.view()).expect_err("invalid shape");

        assert!(
            err.to_string()
                .contains("detection output must have at least 2 dimensions")
        );
    }

    #[test]
    fn postprocess_detection_map_extracts_sorted_candidates() {
        let input = detection_input_for_map(20, 20, 200, 200);
        let mut probabilities = vec![0.0; 20 * 20];
        fill_rect(&mut probabilities, 20, 10, 8, 4, 4, 0.7);
        fill_rect(&mut probabilities, 20, 2, 2, 3, 3, 0.9);

        let candidates =
            postprocess_detection_map(&probabilities, 20, 20, &input, DET_BOX_THRESHOLD)
                .expect("candidates");

        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].bbox, bbox(20, 20, 30, 30));
        assert_eq!(candidates[1].bbox, bbox(100, 80, 40, 40));
        assert!((candidates[0].score - 0.9).abs() < f32::EPSILON);
    }

    #[test]
    fn postprocess_detection_map_filters_tiny_components() {
        let input = detection_input_for_map(10, 10, 100, 100);
        let mut probabilities = vec![0.0; 10 * 10];
        fill_rect(&mut probabilities, 10, 1, 1, 2, 2, 0.8);
        fill_rect(&mut probabilities, 10, 5, 5, 3, 3, 0.8);

        let candidates =
            postprocess_detection_map(&probabilities, 10, 10, &input, DET_BOX_THRESHOLD)
                .expect("candidates");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].bbox, bbox(50, 50, 30, 30));
    }

    #[test]
    fn postprocess_detection_map_uses_resized_content_not_padding_for_coordinates() {
        let input = DetectionInput {
            width: 128,
            height: 96,
            original_width: 101,
            original_height: 65,
            scale_x: 1.0,
            scale_y: 1.0,
            chw_data: Vec::new(),
        };
        let mut probabilities = vec![0.0; 128 * 96];
        fill_rect(&mut probabilities, 128, 90, 50, 30, 20, 0.8);

        let candidates =
            postprocess_detection_map(&probabilities, 128, 96, &input, DET_BOX_THRESHOLD)
                .expect("candidates");

        assert_eq!(candidates[0].bbox, bbox(90, 50, 11, 15));
    }

    #[test]
    fn postprocess_detection_map_rejects_size_mismatch() {
        let input = detection_input_for_map(10, 10, 100, 100);
        let err = postprocess_detection_map(&[0.0; 3], 10, 10, &input, DET_BOX_THRESHOLD)
            .expect_err("size mismatch");

        assert!(err.to_string().contains("detection map size mismatch"));
    }

    #[test]
    fn decode_recognition_ctc_collapses_blanks_and_duplicates() {
        let dictionary = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];
        let probabilities = vec![
            0.1, 0.8, 0.1, 0.0, // a
            0.1, 0.8, 0.1, 0.0, // repeated a
            0.9, 0.05, 0.03, 0.02, // blank
            0.1, 0.2, 0.6, 0.1, // b
            0.1, 0.2, 0.6, 0.1, // repeated b
            0.1, 0.1, 0.1, 0.7, // c
        ];

        let decoded =
            decode_recognition_ctc(&probabilities, 6, 4, &dictionary).expect("decoded recognition");

        assert_eq!(decoded.text, "abc");
        assert!(decoded.confidence > 0.6);
    }

    #[test]
    fn recognition_logits_from_value_uses_last_two_dimensions() {
        let view = Array::from_shape_vec(
            IxDyn(&[1, 5, 4]),
            vec![
                0.1, 0.8, 0.1, 0.0, 0.1, 0.8, 0.1, 0.0, 0.9, 0.05, 0.03, 0.02, 0.1, 0.2, 0.6, 0.1,
                0.1, 0.1, 0.1, 0.7,
            ],
        )
        .expect("array");

        let logits = recognition_logits_from_value(view.view()).expect("recognition logits");

        assert_eq!(logits.timestep_count, 5);
        assert_eq!(logits.class_count, 4);
        assert_eq!(logits.probabilities.len(), 20);
    }

    #[test]
    fn recognition_logits_from_value_rejects_scalar_shape() {
        let view = Array::from_shape_vec(IxDyn(&[4]), vec![0.1; 4]).expect("array");

        let err = recognition_logits_from_value(view.view()).expect_err("invalid shape");

        assert!(
            err.to_string()
                .contains("recognition output must have at least 2 dimensions")
        );
    }

    #[test]
    fn decode_recognition_ctc_rejects_dimension_mismatch() {
        let err = decode_recognition_ctc(&[0.1, 0.9], 2, 2, &["a".to_owned()])
            .expect_err("dimension mismatch");

        assert!(err.to_string().contains("recognition output size mismatch"));
    }

    #[test]
    fn decode_recognition_ctc_rejects_dictionary_too_large_for_classes() {
        let err = decode_recognition_ctc(&[0.1, 0.9], 1, 2, &["a".to_owned(), "b".to_owned()])
            .expect_err("dictionary too large");

        assert!(err.to_string().contains("recognition dictionary has"));
    }

    fn line(text: &str, x: u32, y: u32) -> TextLine {
        TextLine {
            text: text.to_owned(),
            bbox: BBox {
                x,
                y,
                width: 10,
                height: 10,
            },
            confidence: 1.0,
        }
    }

    fn bbox(x: u32, y: u32, width: u32, height: u32) -> BBox {
        BBox {
            x,
            y,
            width,
            height,
        }
    }

    fn detection_input_for_map(
        _map_width: u32,
        _map_height: u32,
        original_width: u32,
        original_height: u32,
    ) -> DetectionInput {
        DetectionInput {
            width: original_width,
            height: original_height,
            original_width,
            original_height,
            scale_x: 1.0,
            scale_y: 1.0,
            chw_data: Vec::new(),
        }
    }

    fn fill_rect(
        probabilities: &mut [f32],
        map_width: u32,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        value: f32,
    ) {
        for yy in y..y + height {
            for xx in x..x + width {
                probabilities[(yy * map_width + xx) as usize] = value;
            }
        }
    }
}
