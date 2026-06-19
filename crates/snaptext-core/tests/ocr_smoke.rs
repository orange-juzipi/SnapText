use std::path::PathBuf;

use image::{DynamicImage, Rgb, RgbImage};
use snaptext_core::ocr::{OcrEngine, aggregate_text};

const MODEL_DIR_ENV: &str = "SNAPTEXT_OCR_MODEL_DIR";

#[tokio::test]
#[ignore = "requires real PP-OCRv6 ONNX files; run with SNAPTEXT_OCR_MODEL_DIR=models"]
async fn pp_ocrv6_fixture_smoke_test_outputs_text() {
    let model_dir = std::env::var_os(MODEL_DIR_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("models"));
    let engine = OcrEngine::new(&model_dir).expect("OCR engine");
    engine
        .validate_assets()
        .unwrap_or_else(|err| panic!("OCR model assets are not ready in {:?}: {err}", model_dir));

    let lines = engine
        .run(render_smoke_fixture())
        .await
        .expect("OCR smoke fixture should run");
    let text = aggregate_text(&lines);

    assert!(
        text.to_ascii_uppercase().contains("SNAP"),
        "expected OCR output to contain SNAP, got: {text:?}"
    );
}

fn render_smoke_fixture() -> DynamicImage {
    let mut image = RgbImage::from_pixel(640, 180, Rgb([255, 255, 255]));
    draw_text(&mut image, 48, 54, 10, "SNAPTEXT");
    DynamicImage::ImageRgb8(image)
}

fn draw_text(image: &mut RgbImage, mut x: u32, y: u32, scale: u32, text: &str) {
    for ch in text.chars() {
        if ch == ' ' {
            x += 4 * scale;
            continue;
        }
        draw_char(image, x, y, scale, ch);
        x += 6 * scale;
    }
}

fn draw_char(image: &mut RgbImage, x: u32, y: u32, scale: u32, ch: char) {
    let Some(glyph) = glyph(ch) else {
        return;
    };
    for (row, bits) in glyph.iter().enumerate() {
        for col in 0..5 {
            if bits & (1 << (4 - col)) == 0 {
                continue;
            }
            fill_rect(
                image,
                x + col * scale,
                y + row as u32 * scale,
                scale,
                scale,
                Rgb([8, 8, 8]),
            );
        }
    }
}

fn fill_rect(image: &mut RgbImage, x: u32, y: u32, width: u32, height: u32, color: Rgb<u8>) {
    for py in y..(y + height).min(image.height()) {
        for px in x..(x + width).min(image.width()) {
            image.put_pixel(px, py, color);
        }
    }
}

fn glyph(ch: char) -> Option<[u8; 7]> {
    match ch {
        'A' => Some([
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ]),
        'E' => Some([
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ]),
        'N' => Some([
            0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001,
        ]),
        'P' => Some([
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ]),
        'S' => Some([
            0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110,
        ]),
        'T' => Some([
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ]),
        'X' => Some([
            0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001,
        ]),
        _ => None,
    }
}
