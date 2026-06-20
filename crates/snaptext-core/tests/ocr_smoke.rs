use std::path::{Path, PathBuf};

use ab_glyph::{Font, FontArc, PxScale, ScaleFont, point};
use image::{DynamicImage, Rgb, RgbImage};
use snaptext_core::ocr::{OcrEngine, aggregate_text};

const MODEL_DIR_ENV: &str = "SNAPTEXT_OCR_MODEL_DIR";
const SMOKE_TEXT: &str = "SNAPTEXT";

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
    if let Some(font) = load_smoke_font() {
        draw_font_text(&mut image, &font, 44.0, 94.0, 84.0, SMOKE_TEXT);
    } else {
        draw_bitmap_text(&mut image, 48, 54, 10, SMOKE_TEXT);
    }
    DynamicImage::ImageRgb8(image)
}

fn load_smoke_font() -> Option<FontArc> {
    [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    .iter()
    .filter_map(|path| std::fs::read(Path::new(path)).ok())
    .find_map(|bytes| FontArc::try_from_vec(bytes).ok())
}

fn draw_font_text(image: &mut RgbImage, font: &FontArc, x: f32, y: f32, size: f32, text: &str) {
    let scale = PxScale::from(size);
    let mut cursor = x;
    for ch in text.chars() {
        let mut glyph = font.as_scaled(scale).scaled_glyph(ch);
        glyph.position = point(cursor, y);
        cursor += font.as_scaled(scale).h_advance(glyph.id);
        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, coverage| {
                if coverage <= 0.0 {
                    return;
                }
                let px = bounds.min.x as i32 + gx as i32;
                let py = bounds.min.y as i32 + gy as i32;
                if px < 0 || py < 0 || px as u32 >= image.width() || py as u32 >= image.height() {
                    return;
                }
                let shade = (255.0 * (1.0 - coverage)).round().clamp(8.0, 255.0) as u8;
                image.put_pixel(px as u32, py as u32, Rgb([shade, shade, shade]));
            });
        }
    }
}

fn draw_bitmap_text(image: &mut RgbImage, mut x: u32, y: u32, scale: u32, text: &str) {
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
