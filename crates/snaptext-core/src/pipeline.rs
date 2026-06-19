use image::DynamicImage;
use serde::{Deserialize, Serialize};

use crate::{
    Error, Result,
    config::Lang,
    history::{HistorySource, NewHistoryRecord},
    ocr::{OcrEngine, TextLine, aggregate_text},
    translate::{TranslateRequest, TranslateResponse, Translator},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranslationResult {
    pub source: HistorySource,
    pub source_text: String,
    pub translated_text: String,
    pub target_lang: String,
    pub text_lines: Vec<TextLine>,
}

impl TranslationResult {
    pub fn into_history_record(self) -> NewHistoryRecord {
        NewHistoryRecord {
            source: self.source,
            source_text: self.source_text,
            target_lang: self.target_lang,
            translated_text: self.translated_text,
        }
    }
}

pub async fn translate_image(
    ocr: &OcrEngine,
    translator: &dyn Translator,
    image: DynamicImage,
    target: Lang,
) -> Result<TranslationResult> {
    translate_image_with_source(ocr, translator, image, target, HistorySource::Image).await
}

pub async fn translate_image_with_source(
    ocr: &OcrEngine,
    translator: &dyn Translator,
    image: DynamicImage,
    target: Lang,
    source: HistorySource,
) -> Result<TranslationResult> {
    let text_lines = ocr.run(image).await?;
    translate_text_lines(translator, text_lines, target, source).await
}

pub async fn translate_text_lines(
    translator: &dyn Translator,
    text_lines: Vec<TextLine>,
    target: Lang,
    source: HistorySource,
) -> Result<TranslationResult> {
    let source_text = aggregate_text(&text_lines);
    if source_text.trim().is_empty() {
        return Err(Error::Ocr(
            "OCR did not detect any translatable text".to_owned(),
        ));
    }

    let TranslateResponse {
        translated_texts, ..
    } = translator
        .translate(TranslateRequest {
            texts: vec![source_text.clone()],
            source: None,
            target: target.clone(),
        })
        .await?;
    let translated_text = first_translated_text(&translated_texts)?;

    Ok(TranslationResult {
        source,
        source_text,
        translated_text,
        target_lang: target.0,
        text_lines,
    })
}

pub fn first_translated_text(translated_texts: &[String]) -> Result<String> {
    let translated_text = translated_texts
        .first()
        .cloned()
        .ok_or_else(|| Error::Translate("translator returned no text".to_owned()))?;
    if translated_text.trim().is_empty() {
        return Err(Error::Translate(
            "translator returned empty text".to_owned(),
        ));
    }

    Ok(translated_text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ocr::BBox;
    use async_trait::async_trait;
    use std::sync::Mutex;

    #[derive(Debug, Default)]
    struct RecordingTranslator {
        requests: Mutex<Vec<TranslateRequest>>,
        response_texts: Vec<String>,
    }

    impl RecordingTranslator {
        fn with_response_texts(response_texts: Vec<String>) -> Self {
            Self {
                requests: Mutex::new(Vec::new()),
                response_texts,
            }
        }
    }

    #[async_trait]
    impl Translator for RecordingTranslator {
        async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse> {
            self.requests.lock().expect("request lock").push(req);
            Ok(TranslateResponse {
                translated_texts: if self.response_texts.is_empty() {
                    vec!["bonjour\nmonde".to_owned()]
                } else {
                    self.response_texts.clone()
                },
                provider: crate::config::TranslatorProvider::LocalHttp,
            })
        }
    }

    #[test]
    fn translation_result_converts_to_history_record() {
        let result = TranslationResult {
            source: HistorySource::Image,
            source_text: "hello".to_owned(),
            translated_text: "bonjour".to_owned(),
            target_lang: "fr".to_owned(),
            text_lines: vec![TextLine {
                text: "hello".to_owned(),
                bbox: BBox {
                    x: 0,
                    y: 0,
                    width: 10,
                    height: 10,
                },
                confidence: 0.99,
            }],
        };

        let record = result.into_history_record();

        assert_eq!(record.source, HistorySource::Image);
        assert_eq!(record.source_text, "hello");
        assert_eq!(record.translated_text, "bonjour");
        assert_eq!(record.target_lang, "fr");
    }

    #[test]
    fn translation_result_preserves_screenshot_source() {
        let result = TranslationResult {
            source: HistorySource::Screenshot,
            source_text: "hello".to_owned(),
            translated_text: "bonjour".to_owned(),
            target_lang: "fr".to_owned(),
            text_lines: Vec::new(),
        };

        let record = result.into_history_record();

        assert_eq!(record.source, HistorySource::Screenshot);
    }

    #[tokio::test]
    async fn translate_text_lines_sorts_and_sends_single_translation_request() {
        let translator = RecordingTranslator::default();
        let result = translate_text_lines(
            &translator,
            vec![line("world", 0, 20), line("hello", 0, 10)],
            Lang("fr".to_owned()),
            HistorySource::Screenshot,
        )
        .await
        .expect("translation result");
        let requests = translator.requests.lock().expect("request lock");

        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].texts, ["hello\nworld"]);
        assert_eq!(requests[0].source, None);
        assert_eq!(requests[0].target, Lang("fr".to_owned()));
        assert_eq!(result.source, HistorySource::Screenshot);
        assert_eq!(result.source_text, "hello\nworld");
        assert_eq!(result.translated_text, "bonjour\nmonde");
        assert_eq!(result.target_lang, "fr");
        assert_eq!(result.text_lines.len(), 2);
    }

    #[tokio::test]
    async fn translate_text_lines_rejects_empty_ocr_output_before_provider_call() {
        let translator = RecordingTranslator::default();
        let err = translate_text_lines(
            &translator,
            vec![line("   ", 0, 10)],
            Lang("fr".to_owned()),
            HistorySource::Image,
        )
        .await
        .expect_err("empty OCR text");
        let requests = translator.requests.lock().expect("request lock");

        assert!(err.to_string().contains("OCR did not detect"));
        assert!(requests.is_empty());
    }

    #[tokio::test]
    async fn translate_text_lines_rejects_empty_translator_output() {
        let translator = RecordingTranslator::with_response_texts(vec!["   ".to_owned()]);
        let err = translate_text_lines(
            &translator,
            vec![line("hello", 0, 10)],
            Lang("fr".to_owned()),
            HistorySource::Image,
        )
        .await
        .expect_err("empty translator output");

        assert!(err.to_string().contains("translator returned empty text"));
    }

    #[test]
    fn first_translated_text_rejects_missing_or_empty_output() {
        let missing = first_translated_text(&[]).expect_err("missing output");
        let empty = first_translated_text(&["\n\t ".to_owned()]).expect_err("empty output");

        assert!(missing.to_string().contains("translator returned no text"));
        assert!(empty.to_string().contains("translator returned empty text"));
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
            confidence: 0.99,
        }
    }
}
