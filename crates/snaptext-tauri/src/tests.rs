use super::*;
use std::io::Cursor;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{ImageFormat, RgbaImage};
use model::resolve_model_dir;
use payload::{image_payload_base64_segment, max_base64_payload_chars};
use snaptext_core::config::{ModelDir, TranslatorProvider};
use tray::{TRAY_HIDE, TRAY_QUIT, TRAY_SHOW, TrayAction, tray_action_for_id};

#[tokio::test]
async fn translate_selection_rejects_empty_text() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err = translate_selection_inner(&state, "   ".to_owned())
        .await
        .expect_err("empty error");

    assert!(err.to_string().contains("selected text cannot be empty"));
}

#[tokio::test]
async fn translate_text_rejects_empty_text() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err = translate_text_inner(&state, "   ".to_owned(), None, None)
        .await
        .expect_err("empty text");

    assert!(err.to_string().contains("selected text cannot be empty"));
}

#[tokio::test]
async fn translate_text_rejects_oversized_text_before_provider_call() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err = translate_text_inner(
        &state,
        "a".repeat(snaptext_core::translate::MAX_TRANSLATE_TEXT_CHARS + 1),
        None,
        None,
    )
    .await
    .expect_err("oversized text");

    assert!(err.to_string().contains("translation text is too long"));
}

#[tokio::test]
async fn translate_text_writes_text_history_source() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");
    set_fake_translated_text(&state, "bonjour");

    let record = translate_text_inner(&state, " hello ".to_owned(), None, None)
        .await
        .expect("translated text record");

    assert_eq!(record.source, HistorySource::Text);
    assert_eq!(record.source_text, "hello");
    assert_eq!(record.translated_text, "bonjour");
    assert_eq!(
        state
            .history
            .lock()
            .expect("history lock")
            .recent(1)
            .expect("recent history")
            .first()
            .expect("history record")
            .source,
        HistorySource::Text
    );
}

#[test]
fn normalize_selection_text_for_translation_removes_control_edges() {
    let text = normalize_selection_text_for_translation("\0 hello\r\nworld \t".to_owned())
        .expect("normalized text");

    assert_eq!(text, "hello\nworld");
    assert!(!text.contains('\0'));
}

#[test]
fn normalize_selection_text_for_translation_rejects_empty_text() {
    let err =
        normalize_selection_text_for_translation("\0\r\n\t ".to_owned()).expect_err("empty text");

    assert!(err.to_string().contains("selected text cannot be empty"));
}

#[test]
fn normalize_selection_text_for_translation_rejects_garbled_text() {
    let err = normalize_selection_text_for_translation(
        "??? API ???????????? AI ???????? OpenAI ?? � ???? base URL ?????".to_owned(),
    )
    .expect_err("garbled selection");

    assert!(
        err.to_string()
            .contains("selected text could not be decoded correctly")
    );
}

#[tokio::test]
async fn translate_selection_reports_provider_errors() {
    let mut config = AppConfig::default();
    config.translator.provider = TranslatorProvider::DeepL;
    let state = AppState::new(config, HistoryStore::in_memory().expect("history store"))
        .expect("app state");

    let err = translate_selection_inner(&state, "hello".to_owned())
        .await
        .expect_err("missing API key");

    assert!(err.to_string().contains("API key is required"));
}

#[tokio::test]
async fn translate_selection_rejects_oversized_text_before_provider_call() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err = translate_selection_inner(
        &state,
        "a".repeat(snaptext_core::translate::MAX_TRANSLATE_TEXT_CHARS + 1),
    )
    .await
    .expect_err("oversized selection text");

    assert!(err.to_string().contains("translation text is too long"));
}

#[tokio::test]
async fn translate_current_selection_reports_missing_selection() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err = translate_optional_selection_inner(&state, None)
        .await
        .expect_err("missing selection");

    assert!(err.to_string().contains("no selected text is available"));
}

#[test]
fn selection_text_payload_normalizes_selected_text() {
    let payload = selection_text_payload_from_optional(Some(SelectionEvent {
        text: "\0 hello \r\n world \t".to_owned(),
        app_bundle_id: Some("com.example.editor".to_owned()),
    }))
    .expect("selection payload");

    assert_eq!(payload.text, "hello\nworld");
    assert_eq!(payload.app_bundle_id.as_deref(), Some("com.example.editor"));
}

#[test]
fn selection_failure_message_separates_permission_and_empty_selection() {
    let permission_message = selection_failure_message(&Error::Selection(
        "Accessibility permission is required before reading selected text".to_owned(),
    ));
    assert!(permission_message.contains("授权系统辅助功能权限"));
    assert!(!permission_message.contains("未读取到选中文本"));

    let empty_message = selection_failure_message(&Error::Selection(
        "no selected text is available".to_owned(),
    ));
    assert!(empty_message.contains("请先选中文本"));
    assert!(!empty_message.contains("辅助功能权限"));
}

#[tokio::test]
async fn retranslate_result_text_rejects_empty_source_text() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err =
        retranslate_result_text_inner(&state, HistorySource::Selection, "   ".to_owned(), None)
            .await
            .expect_err("empty source text");

    assert!(
        err.to_string()
            .contains("source text for retranslating cannot be empty")
    );
}

#[tokio::test]
async fn retranslate_result_text_rejects_oversized_source_text_before_provider_call() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err = retranslate_result_text_inner(
        &state,
        HistorySource::Selection,
        "a".repeat(snaptext_core::translate::MAX_TRANSLATE_TEXT_CHARS + 1),
        None,
    )
    .await
    .expect_err("oversized source text");

    assert!(err.to_string().contains("translation text is too long"));
}

#[test]
fn update_config_persists_and_rebuilds_state() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let config_path = tempdir.path().join("config.yaml");
    let mut config = AppConfig::default();
    config.target_lang.0 = "ja".to_owned();
    let state = AppState::with_config_path(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
        Some(config_path.clone()),
    )
    .expect("app state");

    let updated = update_config_inner(&state, config.clone()).expect("updated config");
    let loaded = AppConfig::load_or_default(Some(config_path)).expect("loaded config");

    assert_eq!(updated.target_lang.0, "ja");
    assert_eq!(loaded.target_lang.0, "ja");
    assert_eq!(get_config_inner(&state).expect("state config"), config);
}

#[test]
fn app_state_migrates_removed_translator_providers() {
    let mut config = AppConfig::default();
    config.translator.provider = TranslatorProvider::LocalHttp;
    let state = AppState::new(config, HistoryStore::in_memory().expect("history store"))
        .expect("app state");

    assert_eq!(
        get_config_inner(&state)
            .expect("state config")
            .translator
            .provider,
        TranslatorProvider::SnapTextCloud
    );
}

#[test]
fn update_config_normalizes_saved_and_runtime_values() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let config_path = tempdir.path().join("config.yaml");
    let mut config = AppConfig::default();
    config.target_lang.0 = " ja ".to_owned();
    config.hotkeys.screenshot = " CmdOrCtrl+Shift+T ".to_owned();
    config.hotkeys.selection = " Alt+F8 ".to_owned();
    config.translator.openai_compatible.api_key = Some(" sk-test ".to_owned());
    config.translator.openai_compatible.model = " gpt-test ".to_owned();
    config.translator.deepl.api_key = Some("   ".to_owned());
    config.ocr.model_dir = ModelDir::Custom(std::path::PathBuf::from(" ./models "));
    let state = AppState::with_config_path(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
        Some(config_path.clone()),
    )
    .expect("app state");

    let updated = update_config_inner(&state, config).expect("updated config");
    let loaded = AppConfig::load_or_default(Some(config_path)).expect("loaded config");

    assert_eq!(updated.target_lang.0, "ja");
    assert_eq!(updated.hotkeys.selection, "Alt+F8");
    assert_eq!(
        updated.translator.openai_compatible.api_key.as_deref(),
        Some("sk-test")
    );
    assert_eq!(updated.translator.openai_compatible.model, "gpt-test");
    assert_eq!(updated.translator.deepl.api_key, None);
    assert_eq!(
        updated.ocr.model_dir,
        ModelDir::Custom(std::path::PathBuf::from("./models"))
    );
    assert_eq!(loaded, updated);
    assert_eq!(get_config_inner(&state).expect("state config"), updated);
}

#[test]
fn update_config_rejects_duplicate_hotkeys_without_replacing_state() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let config_path = tempdir.path().join("config.yaml");
    let original = AppConfig::default();
    let mut invalid = original.clone();
    invalid.hotkeys.selection = invalid.hotkeys.screenshot.clone();
    let state = AppState::with_config_path(
        original.clone(),
        HistoryStore::in_memory().expect("history store"),
        Some(config_path.clone()),
    )
    .expect("app state");

    let err = update_config_inner(&state, invalid).expect_err("duplicate hotkeys");

    assert!(
        err.to_string()
            .contains("screenshot and selection hotkeys must be different")
    );
    assert_eq!(get_config_inner(&state).expect("state config"), original);
    assert!(!config_path.exists());
}

#[test]
fn bundled_model_dir_defaults_to_development_models_path() {
    let config = AppConfig::default();

    assert_eq!(
        resolve_model_dir(&config, None),
        std::path::Path::new("models")
    );
}

#[test]
fn bundled_model_dir_uses_packaged_resource_dir_when_available() {
    let config = AppConfig::default();
    let resource_dir = std::path::Path::new("/tmp/snaptext-resources");

    assert_eq!(
        resolve_model_dir(&config, Some(resource_dir)),
        resource_dir.join("models")
    );
}

#[test]
fn validate_ocr_models_reports_missing_files() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let status = validate_ocr_models_inner(&state).expect("model status");

    assert!(!status.valid);
    assert!(status.missing_files.contains(&"det.onnx".to_owned()));
    assert!(status.missing_files.contains(&"cls.onnx".to_owned()));
    assert!(status.missing_files.contains(&"rec.onnx".to_owned()));
    assert!(status.missing_files.contains(&"rec_dict.txt".to_owned()));
    assert_eq!(status.recognition_dict_len, 0);
    assert!(!status.loadable);
    assert!(status.message.contains("missing required files"));
}

#[test]
fn validate_ocr_models_reports_unloadable_onnx_files() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    std::fs::write(tempdir.path().join("det.onnx"), b"det").expect("det");
    std::fs::write(tempdir.path().join("cls.onnx"), b"cls").expect("cls");
    std::fs::write(tempdir.path().join("rec.onnx"), b"rec").expect("rec");
    std::fs::write(tempdir.path().join("rec_dict.txt"), "a\n").expect("dict");

    let mut config = AppConfig::default();
    config.ocr.model_dir = ModelDir::Custom(tempdir.path().to_path_buf());
    let state = AppState::new(config, HistoryStore::in_memory().expect("history store"))
        .expect("app state");

    let status = validate_ocr_models_inner(&state).expect("model status");

    assert!(!status.valid);
    assert!(status.missing_files.is_empty());
    assert_eq!(status.recognition_dict_len, 1);
    assert!(!status.loadable);
    assert!(status.message.contains("ONNX sessions failed to load"));
}

#[tokio::test]
async fn translate_image_base64_rejects_invalid_image_data() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err = translate_image_base64_inner(&state, "not-image".to_owned())
        .await
        .expect_err("invalid image");

    assert!(err.to_string().contains("image failed"));
}

#[tokio::test]
async fn translate_screenshot_region_rejects_empty_region_before_ocr() {
    let state = AppState::new(
        AppConfig::default(),
        HistoryStore::in_memory().expect("history store"),
    )
    .expect("app state");

    let err = translate_screenshot_region_inner(
        &state,
        snaptext_core::ocr::BBox {
            x: 0,
            y: 0,
            width: 0,
            height: 10,
        },
    )
    .await
    .expect_err("empty region");

    assert!(err.to_string().contains("capture region cannot be empty"));
}

#[test]
fn tray_action_ids_map_to_expected_actions() {
    assert_eq!(tray_action_for_id(TRAY_SHOW), Some(TrayAction::Show));
    assert_eq!(tray_action_for_id(TRAY_HIDE), Some(TrayAction::Hide));
    assert_eq!(tray_action_for_id(TRAY_QUIT), Some(TrayAction::Quit));
    assert_eq!(tray_action_for_id("unknown"), None);
}

#[test]
fn parse_history_source_maps_supported_values() {
    assert_eq!(
        parse_history_source("text").expect("text source"),
        HistorySource::Text
    );
    assert_eq!(
        parse_history_source("selection").expect("selection source"),
        HistorySource::Selection
    );
    assert_eq!(
        parse_history_source("screenshot").expect("screenshot source"),
        HistorySource::Screenshot
    );
    assert_eq!(
        parse_history_source("image").expect("image source"),
        HistorySource::Image
    );
}

#[test]
fn parse_history_source_trims_command_boundary_input() {
    assert_eq!(
        parse_history_source(" \nselection\t").expect("selection source"),
        HistorySource::Selection
    );
}

#[test]
fn parse_history_source_rejects_unknown_value() {
    let err = parse_history_source("unknown").expect_err("unsupported source");

    assert!(err.to_string().contains("unsupported history source"));
}

#[test]
fn history_record_to_translation_result_preserves_snapshot_fields() {
    let record = HistoryRecord {
        id: 42,
        created_at: 1_789_000_000,
        source: HistorySource::Screenshot,
        source_text: String::from("hello\nworld"),
        target_lang: String::from("ja"),
        translated_text: String::from("konnichiwa\nsekai"),
        dictionary_entries: Vec::new(),
    };

    let result = history_record_to_translation_result(&record);

    assert_eq!(result.source, HistorySource::Screenshot);
    assert_eq!(result.source_text, "hello\nworld");
    assert_eq!(result.target_lang, "ja");
    assert_eq!(result.translated_text, "konnichiwa\nsekai");
    assert!(result.text_lines.is_empty());
}

#[test]
fn overlay_translation_payload_preserves_result_and_region() {
    let result = TranslationResult {
        source: HistorySource::Screenshot,
        source_text: String::from("hello"),
        translated_text: String::from("bonjour"),
        target_lang: String::from("fr"),
        text_lines: Vec::new(),
        dictionary_entries: Vec::new(),
    };
    let region = snaptext_core::ocr::BBox {
        x: 10,
        y: 20,
        width: 200,
        height: 80,
    };

    let payload = OverlayTranslationPayload {
        result: result.clone(),
        region,
    };

    assert_eq!(payload.result, result);
    assert_eq!(payload.region, region);
}

#[test]
fn result_window_state_targets_include_main_window_only() {
    assert_eq!(result_window_state_targets(), [MAIN_WINDOW_LABEL]);
}

#[test]
fn screenshot_payload_encodes_png_metadata() {
    let image = RgbaImage::new(2, 3);

    let payload = ScreenshotPayload::from_image(image).expect("screenshot payload");

    assert_eq!(payload.meta.width, 2);
    assert_eq!(payload.meta.height, 3);
    assert!(!payload.base64_png.is_empty());
}

#[test]
fn image_payload_base64_segment_accepts_raw_or_data_url_payloads() {
    assert_eq!(
        image_payload_base64_segment("  aGVsbG8=  ").expect("raw payload"),
        "aGVsbG8="
    );
    assert_eq!(
        image_payload_base64_segment("data:image/png;base64, aGVsbG8= ").expect("data URL"),
        "aGVsbG8="
    );
    assert_eq!(
        image_payload_base64_segment("data:image/jpeg;charset=utf-8;base64, aGVsbG8= ")
            .expect("jpeg data URL"),
        "aGVsbG8="
    );
    assert_eq!(
        image_payload_base64_segment("data:image/webp;BASE64,aGVsbG8=").expect("webp data URL"),
        "aGVsbG8="
    );
}

#[test]
fn image_payload_base64_segment_rejects_invalid_data_urls() {
    let missing_payload =
        image_payload_base64_segment("data:image/png;base64").expect_err("missing payload");
    let not_base64 =
        image_payload_base64_segment("data:image/png,abc").expect_err("missing base64 marker");
    let unsupported_media_type = image_payload_base64_segment("data:text/plain;base64,abc")
        .expect_err("unsupported media type");
    let missing_media_type =
        image_payload_base64_segment("data:;base64,abc").expect_err("missing media type");

    assert!(
        missing_payload
            .to_string()
            .contains("image data URL is missing base64 payload")
    );
    assert!(
        not_base64
            .to_string()
            .contains("image data URL must be base64 encoded")
    );
    assert!(
        unsupported_media_type
            .to_string()
            .contains("media type `text/plain` is not supported")
    );
    assert!(
        missing_media_type
            .to_string()
            .contains("media type `` is not supported")
    );
}

#[test]
fn base64_image_loader_accepts_plan_image_formats() {
    for format in [ImageFormat::Png, ImageFormat::Jpeg, ImageFormat::WebP] {
        let image =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(3, 2, image::Rgba([10, 20, 30, 255])));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), format)
            .expect("encode image");
        let payload = STANDARD.encode(bytes);

        let decoded = base64_image_to_dynamic_image(&payload).expect("decode image");

        assert_eq!(decoded.width(), 3);
        assert_eq!(decoded.height(), 2);
    }
}

#[test]
fn base64_image_loader_rejects_non_plan_image_formats() {
    let payload = STANDARD.encode(b"GIF89a\x01\x00\x01\x00\x00\x00\x00");

    let err = base64_image_to_dynamic_image(&payload).expect_err("unsupported image format");

    assert!(err.to_string().contains("unsupported image format"));
    assert!(err.to_string().contains("PNG, JPEG, or WebP"));
}

#[test]
fn base64_image_loader_accepts_data_url_payload() {
    let image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(3, 2, image::Rgba([10, 20, 30, 255])));
    let mut bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .expect("encode image");
    let payload = format!("data:image/png;base64,{}", STANDARD.encode(bytes));

    let decoded = base64_image_to_dynamic_image(&payload).expect("decode data URL image");

    assert_eq!(decoded.width(), 3);
    assert_eq!(decoded.height(), 2);
}

#[test]
fn base64_image_loader_rejects_empty_payload() {
    let err = base64_image_to_dynamic_image("   ").expect_err("empty payload");

    assert!(err.to_string().contains("image payload cannot be empty"));
}

#[test]
fn base64_image_loader_rejects_oversized_payload_bytes() {
    let payload = "A".repeat(max_base64_payload_chars() + 1);

    let err = base64_image_to_dynamic_image(&payload).expect_err("oversized payload");

    assert!(err.to_string().contains("image payload is too large"));
}

#[test]
fn decoded_image_dimension_validation_rejects_oversized_images() {
    let image = DynamicImage::new_rgba8(6000, 5000);

    let err = validate_decoded_image_dimensions(&image).expect_err("oversized image");

    assert!(err.to_string().contains("image is too large"));
    assert!(err.to_string().contains("6000x5000"));
}

#[test]
fn crop_image_rejects_empty_or_out_of_bounds_regions() {
    let image = DynamicImage::ImageRgba8(RgbaImage::new(10, 10));

    let empty = crop_image(
        &image,
        snaptext_core::ocr::BBox {
            x: 0,
            y: 0,
            width: 0,
            height: 1,
        },
    )
    .expect_err("empty region");
    assert!(empty.to_string().contains("capture region cannot be empty"));

    let outside = crop_image(
        &image,
        snaptext_core::ocr::BBox {
            x: 20,
            y: 0,
            width: 1,
            height: 1,
        },
    )
    .expect_err("outside region");
    assert!(outside.to_string().contains("outside the screenshot"));
}

#[cfg(target_os = "macos")]
#[test]
fn mac_screenshot_selection_error_includes_status_or_stderr() {
    assert_eq!(
        mac_screenshot_selection_error(Some(1), b""),
        "screenshot selection produced no image; status=1"
    );
    assert_eq!(
        mac_screenshot_selection_error(Some(1), b"permission denied\n"),
        "screenshot selection failed: permission denied"
    );
}
