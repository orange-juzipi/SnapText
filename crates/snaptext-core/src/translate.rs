use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    Error, Result,
    config::{
        DeepLConfig, GoogleConfig, Lang, LocalHttpConfig, OpenAiCompatibleConfig,
        SnapTextCloudConfig, TranslatorConfig, TranslatorProvider,
    },
};

pub const MAX_TRANSLATE_TEXTS: usize = 8;
pub const MAX_TRANSLATE_TEXT_CHARS: usize = 12_000;
pub const MAX_TRANSLATE_TOTAL_CHARS: usize = 24_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranslateRequest {
    pub texts: Vec<String>,
    pub source: Option<Lang>,
    pub target: Lang,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranslateResponse {
    pub translated_texts: Vec<String>,
    pub provider: TranslatorProvider,
}

#[async_trait]
pub trait Translator: Send + Sync {
    async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse>;
}

#[derive(Debug, Clone)]
pub struct TranslatorRegistry {
    config: TranslatorConfig,
    client: Client,
}

impl TranslatorRegistry {
    pub fn new(config: TranslatorConfig) -> Self {
        Self::with_client(config, Client::new())
    }

    pub fn with_client(config: TranslatorConfig, client: Client) -> Self {
        Self { config, client }
    }

    pub fn provider(&self) -> &TranslatorProvider {
        &self.config.provider
    }

    pub async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse> {
        match self.config.provider {
            TranslatorProvider::SnapTextCloud => {
                SnapTextCloudTranslator::new(
                    self.config.snaptext_cloud.clone(),
                    self.client.clone(),
                )
                .translate(req)
                .await
            }
            TranslatorProvider::OpenAiCompatible => {
                OpenAiCompatibleTranslator::new(
                    self.config.openai_compatible.clone(),
                    self.client.clone(),
                )
                .translate(req)
                .await
            }
            TranslatorProvider::DeepL => {
                DeepLTranslator::new(self.config.deepl.clone(), self.client.clone())
                    .translate(req)
                    .await
            }
            TranslatorProvider::Google => {
                GoogleTranslator::new(self.config.google.clone(), self.client.clone())
                    .translate(req)
                    .await
            }
            TranslatorProvider::LocalHttp => {
                LocalHttpTranslator::new(self.config.local_http.clone(), self.client.clone())
                    .translate(req)
                    .await
            }
        }
    }
}

#[async_trait]
impl Translator for TranslatorRegistry {
    async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse> {
        self.translate(req).await
    }
}

#[derive(Debug, Clone)]
pub struct SnapTextCloudTranslator {
    config: SnapTextCloudConfig,
    client: Client,
}

impl SnapTextCloudTranslator {
    pub fn new(config: SnapTextCloudConfig, client: Client) -> Self {
        Self { config, client }
    }
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleTranslator {
    config: OpenAiCompatibleConfig,
    client: Client,
}

impl OpenAiCompatibleTranslator {
    pub fn new(config: OpenAiCompatibleConfig, client: Client) -> Self {
        Self { config, client }
    }
}

#[derive(Debug, Clone)]
pub struct DeepLTranslator {
    config: DeepLConfig,
    client: Client,
}

impl DeepLTranslator {
    pub fn new(config: DeepLConfig, client: Client) -> Self {
        Self { config, client }
    }
}

#[derive(Debug, Clone)]
pub struct GoogleTranslator {
    config: GoogleConfig,
    client: Client,
}

impl GoogleTranslator {
    pub fn new(config: GoogleConfig, client: Client) -> Self {
        Self { config, client }
    }
}

#[derive(Debug, Clone)]
pub struct LocalHttpTranslator {
    config: LocalHttpConfig,
    client: Client,
}

impl LocalHttpTranslator {
    pub fn new(config: LocalHttpConfig, client: Client) -> Self {
        Self { config, client }
    }
}

#[async_trait]
impl Translator for SnapTextCloudTranslator {
    async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse> {
        validate_translate_request(&req)?;
        if !self.config.enabled {
            return Err(Error::Translate(
                "SnapText Cloud provider is disabled".to_owned(),
            ));
        }

        let endpoint = snaptext_cloud_translate_endpoint(&self.config)?;
        let mut translated_texts = Vec::with_capacity(req.texts.len());
        // The cloud API is intentionally single-text; keep the desktop batch contract by
        // issuing ordered per-item requests and returning the same number of translations.
        for text in &req.texts {
            let payload = snaptext_cloud_payload(&req, text);
            let value = self
                .client
                .post(endpoint.clone())
                .header("X-SnapText-Device", &self.config.device_id)
                .header("X-SnapText-Version", env!("CARGO_PKG_VERSION"))
                .json(&payload)
                .send()
                .await?
                .error_for_status_json()
                .await?;
            let translated_text = value
                .get("translated_text")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| {
                    Error::Translate("SnapText Cloud response missing translated_text".to_owned())
                })?;
            translated_texts.push(translated_text);
        }
        validate_translate_response_texts(&translated_texts, req.texts.len())?;

        Ok(TranslateResponse {
            translated_texts,
            provider: TranslatorProvider::SnapTextCloud,
        })
    }
}

#[async_trait]
impl Translator for OpenAiCompatibleTranslator {
    async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse> {
        validate_translate_request(&req)?;
        let api_key = required_key(self.config.api_key.as_deref(), "OpenAI compatible")?;
        let endpoint = openai_chat_endpoint(&self.config)?;
        let payload = openai_payload(&self.config, &req);

        let value = self
            .client
            .post(endpoint)
            .bearer_auth(api_key)
            .json(&payload)
            .send()
            .await?
            .error_for_status_json()
            .await?;

        let content = value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                Error::Translate("OpenAI response missing message content".to_owned())
            })?;
        let translated_texts = parse_openai_content(content)?;
        validate_translate_response_texts(&translated_texts, req.texts.len())?;

        Ok(TranslateResponse {
            translated_texts,
            provider: TranslatorProvider::OpenAiCompatible,
        })
    }
}

#[async_trait]
impl Translator for DeepLTranslator {
    async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse> {
        validate_translate_request(&req)?;
        let api_key = required_key(self.config.api_key.as_deref(), "DeepL")?;
        let endpoint = deepl_translate_endpoint(&self.config)?;
        let payload = deepl_payload(&req);

        let value = self
            .client
            .post(endpoint)
            .header("Authorization", format!("DeepL-Auth-Key {api_key}"))
            .json(&payload)
            .send()
            .await?
            .error_for_status_json()
            .await?;
        let translated_texts = value
            .get("translations")
            .and_then(Value::as_array)
            .ok_or_else(|| Error::Translate("DeepL response missing translations".to_owned()))?
            .iter()
            .map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| Error::Translate("DeepL translation missing text".to_owned()))
            })
            .collect::<Result<Vec<_>>>()?;
        validate_translate_response_texts(&translated_texts, req.texts.len())?;

        Ok(TranslateResponse {
            translated_texts,
            provider: TranslatorProvider::DeepL,
        })
    }
}

#[async_trait]
impl Translator for GoogleTranslator {
    async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse> {
        validate_translate_request(&req)?;
        let api_key = required_key(self.config.api_key.as_deref(), "Google Translate")?;
        let payload = google_payload(&req, api_key);

        let value = self
            .client
            .post(self.config.base_url.clone())
            .json(&payload)
            .send()
            .await?
            .error_for_status_json()
            .await?;
        let translated_texts = value
            .pointer("/data/translations")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                Error::Translate("Google response missing data.translations".to_owned())
            })?
            .iter()
            .map(|item| {
                item.get("translatedText")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| {
                        Error::Translate("Google translation missing translatedText".to_owned())
                    })
            })
            .collect::<Result<Vec<_>>>()?;
        validate_translate_response_texts(&translated_texts, req.texts.len())?;

        Ok(TranslateResponse {
            translated_texts,
            provider: TranslatorProvider::Google,
        })
    }
}

#[async_trait]
impl Translator for LocalHttpTranslator {
    async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse> {
        validate_translate_request(&req)?;
        let value = self
            .client
            .post(self.config.endpoint.clone())
            .json(&req)
            .send()
            .await?
            .error_for_status_json()
            .await?;
        let translated_texts = parse_local_http_response(value)?;
        validate_translate_response_texts(&translated_texts, req.texts.len())?;

        Ok(TranslateResponse {
            translated_texts,
            provider: TranslatorProvider::LocalHttp,
        })
    }
}

pub fn validate_translate_request(req: &TranslateRequest) -> Result<()> {
    if req.texts.is_empty() {
        return Err(Error::Translate(
            "translation request must contain at least one text".to_owned(),
        ));
    }
    if req.texts.len() > MAX_TRANSLATE_TEXTS {
        return Err(Error::Translate(format!(
            "translation request contains {} texts; maximum is {}",
            req.texts.len(),
            MAX_TRANSLATE_TEXTS
        )));
    }
    if req.texts.iter().any(|text| text.trim().is_empty()) {
        return Err(Error::Translate(
            "translation request cannot contain empty text".to_owned(),
        ));
    }
    let mut total_chars = 0usize;
    for text in &req.texts {
        let char_count = text.chars().count();
        if char_count > MAX_TRANSLATE_TEXT_CHARS {
            return Err(Error::Translate(format!(
                "translation text is too long: {char_count} characters; maximum is {MAX_TRANSLATE_TEXT_CHARS}"
            )));
        }
        total_chars += char_count;
    }
    if total_chars > MAX_TRANSLATE_TOTAL_CHARS {
        return Err(Error::Translate(format!(
            "translation request is too long: {total_chars} characters; maximum is {MAX_TRANSLATE_TOTAL_CHARS}"
        )));
    }
    if req.target.0.trim().is_empty() {
        return Err(Error::Translate(
            "target language cannot be empty".to_owned(),
        ));
    }
    Ok(())
}

pub fn validate_translate_response_texts(
    translated_texts: &[String],
    expected_count: usize,
) -> Result<()> {
    if translated_texts.len() != expected_count {
        return Err(Error::Translate(format!(
            "translator returned {} texts for {expected_count} input texts",
            translated_texts.len()
        )));
    }
    if translated_texts.iter().any(|text| text.trim().is_empty()) {
        return Err(Error::Translate(
            "translator returned empty text".to_owned(),
        ));
    }

    Ok(())
}

fn required_key<'a>(key: Option<&'a str>, provider: &str) -> Result<&'a str> {
    key.filter(|value| !value.trim().is_empty())
        .ok_or_else(|| Error::Translate(format!("{provider} API key is required")))
}

fn openai_chat_endpoint(config: &OpenAiCompatibleConfig) -> Result<Url> {
    join_url(&config.base_url, "chat/completions")
}

fn deepl_translate_endpoint(config: &DeepLConfig) -> Result<Url> {
    join_url(&config.base_url, "translate")
}

fn snaptext_cloud_translate_endpoint(config: &SnapTextCloudConfig) -> Result<Url> {
    join_url(&config.endpoint, "v1/translate")
}

fn snaptext_cloud_payload(req: &TranslateRequest, text: &str) -> Value {
    json!({
        "text": text,
        "source_lang": req.source.as_ref().map(|lang| lang.0.as_str()).unwrap_or("auto"),
        "target_lang": req.target.0,
        "scene": "text",
        "mode": "balanced",
        "client_version": env!("CARGO_PKG_VERSION"),
    })
}

fn openai_payload(config: &OpenAiCompatibleConfig, req: &TranslateRequest) -> Value {
    let source = req
        .source
        .as_ref()
        .map(|lang| lang.0.as_str())
        .unwrap_or("auto");

    json!({
        "model": config.model,
        "messages": [
            {
                "role": "system",
                "content": "Translate each input item into the target language. Return only a JSON array of translated strings in the same order."
            },
            {
                "role": "user",
                "content": json!({
                    "source": source,
                    "target": req.target.0,
                    "texts": req.texts,
                }).to_string()
            }
        ],
        "temperature": 0
    })
}

fn deepl_payload(req: &TranslateRequest) -> Value {
    let mut payload = json!({
        "text": req.texts,
        "target_lang": req.target.0.to_uppercase(),
    });
    if let Some(source) = req.source.as_ref() {
        payload["source_lang"] = Value::String(source.0.to_uppercase());
    }
    payload
}

fn google_payload(req: &TranslateRequest, api_key: &str) -> Value {
    let mut payload = json!({
        "q": req.texts,
        "target": req.target.0,
        "format": "text",
        "key": api_key,
    });
    if let Some(source) = req.source.as_ref() {
        payload["source"] = Value::String(source.0.clone());
    }
    payload
}

fn join_url(base: &Url, path: &str) -> Result<Url> {
    let mut url = base.clone();
    let mut base_path = url.path().trim_end_matches('/').to_owned();
    if !path.is_empty() {
        base_path.push('/');
        base_path.push_str(path.trim_start_matches('/'));
    }
    url.set_path(&base_path);
    Ok(url)
}

fn parse_openai_content(content: &str) -> Result<Vec<String>> {
    if let Ok(texts) = serde_json::from_str::<Vec<String>>(content) {
        return Ok(texts);
    }

    // Some OpenAI-compatible services return a plain string. Keep that usable
    // for single-item translations while still preferring structured JSON.
    Ok(vec![content.trim().to_owned()])
}

fn parse_local_http_response(value: Value) -> Result<Vec<String>> {
    if let Some(texts) = value.get("translated_texts").and_then(Value::as_array) {
        return texts
            .iter()
            .map(|item| {
                item.as_str().map(str::to_owned).ok_or_else(|| {
                    Error::Translate("local_http translated_texts must be strings".to_owned())
                })
            })
            .collect::<Result<Vec<_>>>();
    }

    if let Some(text) = value.get("translated_text").and_then(Value::as_str) {
        return Ok(vec![text.to_owned()]);
    }

    Err(Error::Translate(
        "local_http response must include translated_texts or translated_text".to_owned(),
    ))
}

trait JsonStatusExt {
    async fn error_for_status_json(self) -> Result<Value>;
}

impl JsonStatusExt for reqwest::Response {
    async fn error_for_status_json(self) -> Result<Value> {
        let status = self.status();
        let text = self.text().await?;
        if !status.is_success() {
            return Err(http_status_error(status, text));
        }

        serde_json::from_str(&text).map_err(|err| Error::Translate(err.to_string()))
    }
}

fn http_status_error(status: StatusCode, body: String) -> Error {
    Error::Translate(format!("HTTP {status}: {body}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use std::{
        collections::HashMap,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::mpsc::{self, Receiver},
        thread::{self, JoinHandle},
        time::Duration,
    };

    #[derive(Debug)]
    struct RecordedRequest {
        method: String,
        path: String,
        headers: HashMap<String, String>,
        body: String,
    }

    struct MockServer {
        url: Url,
        requests: Receiver<RecordedRequest>,
        handle: JoinHandle<()>,
    }

    impl MockServer {
        fn spawn(response_body: &'static str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
            let url = Url::parse(&format!("http://{}", listener.local_addr().expect("addr")))
                .expect("mock server URL");
            let (requests_tx, requests_rx) = mpsc::channel();

            let handle = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept request");
                let request = read_http_request(&mut stream).expect("read request");
                requests_tx.send(request).expect("record request");

                // Keep the response intentionally small and deterministic so provider tests
                // exercise reqwest's JSON/status handling without depending on the network.
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                )
                .expect("write mock response");
            });

            Self {
                url,
                requests: requests_rx,
                handle,
            }
        }

        fn endpoint(&self, path: &str) -> Url {
            self.url.join(path).expect("mock endpoint")
        }

        fn take_request(self) -> RecordedRequest {
            let request = self
                .requests
                .recv_timeout(Duration::from_secs(5))
                .expect("mock request");
            self.handle.join().expect("mock server thread");
            request
        }
    }

    fn read_http_request(stream: &mut TcpStream) -> std::io::Result<RecordedRequest> {
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut bytes = Vec::new();
        let mut chunk = [0_u8; 4096];
        let header_end = loop {
            let read = stream.read(&mut chunk)?;
            if read == 0 {
                break None;
            }
            bytes.extend_from_slice(&chunk[..read]);
            if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break Some(index + 4);
            }
        }
        .expect("mock request headers");

        let header_text = String::from_utf8_lossy(&bytes[..header_end]);
        let mut lines = header_text.split("\r\n");
        let request_line = lines.next().expect("request line");
        let mut request_parts = request_line.split_whitespace();
        let method = request_parts.next().expect("method").to_owned();
        let path = request_parts.next().expect("path").to_owned();

        let mut headers = HashMap::new();
        for line in lines.filter(|line| !line.is_empty()) {
            if let Some((name, value)) = line.split_once(':') {
                headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
            }
        }

        let content_length = headers
            .get("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        while bytes.len() < header_end + content_length {
            let read = stream.read(&mut chunk)?;
            if read == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..read]);
        }

        let body =
            String::from_utf8_lossy(&bytes[header_end..header_end + content_length]).to_string();
        Ok(RecordedRequest {
            method,
            path,
            headers,
            body,
        })
    }

    #[tokio::test]
    async fn registry_uses_configured_provider() {
        let mut config = AppConfig::default().translator;
        config.provider = TranslatorProvider::LocalHttp;
        let registry = TranslatorRegistry::new(config);

        let err = registry
            .translate(TranslateRequest {
                texts: vec!["hello".to_owned()],
                source: None,
                target: Lang("zh".to_owned()),
            })
            .await
            .expect_err("local server is unavailable");

        assert_eq!(registry.provider(), &TranslatorProvider::LocalHttp);
        assert!(err.to_string().contains("translation failed"));
    }

    #[test]
    fn deepl_payload_uses_expected_shape() {
        let payload = deepl_payload(&sample_request());

        assert_eq!(payload["text"], json!(["Hello"]));
        assert_eq!(payload["source_lang"], "EN");
        assert_eq!(payload["target_lang"], "FR");
    }

    #[test]
    fn google_payload_uses_expected_shape() {
        let payload = google_payload(&sample_request(), "key-123");

        assert_eq!(payload["q"], json!(["Hello"]));
        assert_eq!(payload["source"], "en");
        assert_eq!(payload["target"], "fr");
        assert_eq!(payload["format"], "text");
        assert_eq!(payload["key"], "key-123");
    }

    #[test]
    fn openai_payload_uses_chat_completions_shape() {
        let mut config = AppConfig::default().translator.openai_compatible;
        config.model = "test-model".to_owned();
        let payload = openai_payload(&config, &sample_request());
        let user_content = payload["messages"][1]["content"]
            .as_str()
            .expect("user content");
        let user_json: Value = serde_json::from_str(user_content).expect("user JSON");

        assert_eq!(payload["model"], "test-model");
        assert_eq!(payload["messages"][0]["role"], "system");
        assert_eq!(payload["messages"][1]["role"], "user");
        assert_eq!(payload["temperature"], 0);
        assert_eq!(user_json["source"], "en");
        assert_eq!(user_json["target"], "fr");
        assert_eq!(user_json["texts"], json!(["Hello"]));
    }

    #[test]
    fn parses_provider_responses() {
        let openai = parse_openai_content(r#"["Bonjour"]"#).expect("openai content");
        let local = parse_local_http_response(json!({
            "translated_texts": ["Bonjour"]
        }))
        .expect("local response");

        assert_eq!(openai, ["Bonjour"]);
        assert_eq!(local, ["Bonjour"]);
    }

    #[test]
    fn validate_translate_request_rejects_oversized_inputs() {
        let too_many = TranslateRequest {
            texts: vec![String::from("hello"); MAX_TRANSLATE_TEXTS + 1],
            source: None,
            target: Lang("fr".to_owned()),
        };
        let too_long_text = TranslateRequest {
            texts: vec!["a".repeat(MAX_TRANSLATE_TEXT_CHARS + 1)],
            source: None,
            target: Lang("fr".to_owned()),
        };
        let too_long_total = TranslateRequest {
            texts: vec![
                "a".repeat(MAX_TRANSLATE_TEXT_CHARS),
                "b".repeat(MAX_TRANSLATE_TEXT_CHARS),
                "c".to_owned(),
            ],
            source: None,
            target: Lang("fr".to_owned()),
        };

        let too_many_err = validate_translate_request(&too_many).expect_err("too many texts");
        let too_long_text_err =
            validate_translate_request(&too_long_text).expect_err("single text too long");
        let too_long_total_err =
            validate_translate_request(&too_long_total).expect_err("total text too long");

        assert!(too_many_err.to_string().contains("maximum is 8"));
        assert!(
            too_long_text_err
                .to_string()
                .contains("translation text is too long")
        );
        assert!(
            too_long_total_err
                .to_string()
                .contains("translation request is too long")
        );
    }

    #[test]
    fn validate_translate_response_rejects_wrong_count_or_empty_text() {
        let wrong_count =
            validate_translate_response_texts(&["Bonjour".to_owned()], 2).expect_err("wrong count");
        let empty_text =
            validate_translate_response_texts(&[" ".to_owned()], 1).expect_err("empty translation");

        assert!(
            wrong_count
                .to_string()
                .contains("translator returned 1 texts for 2 input texts")
        );
        assert!(
            empty_text
                .to_string()
                .contains("translator returned empty text")
        );
    }

    #[tokio::test]
    async fn missing_provider_key_is_rejected_before_http() {
        let config = AppConfig::default().translator.openai_compatible;
        let translator = OpenAiCompatibleTranslator::new(config, Client::new());

        let err = translator
            .translate(TranslateRequest {
                texts: vec!["Hello".to_owned()],
                source: None,
                target: Lang("fr".to_owned()),
            })
            .await
            .expect_err("missing API key");

        assert!(err.to_string().contains("API key is required"));
    }

    #[tokio::test]
    #[ignore = "requires loopback listener; run through scripts/verify_translator_providers.py"]
    async fn openai_provider_translates_through_mock_http_server() {
        let server = MockServer::spawn(r#"{"choices":[{"message":{"content":"[\"Bonjour\"]"}}]}"#);
        let mut config = AppConfig::default().translator.openai_compatible;
        config.base_url = server.endpoint("v1");
        config.api_key = Some("openai-key".to_owned());

        let translator = OpenAiCompatibleTranslator::new(config, Client::new());
        let response = translator
            .translate(sample_request())
            .await
            .expect("openai translation");
        let request = server.take_request();
        let body: Value = serde_json::from_str(&request.body).expect("openai request JSON");
        let user_content = body["messages"][1]["content"]
            .as_str()
            .expect("user content");
        let user_json: Value = serde_json::from_str(user_content).expect("user JSON");

        assert_eq!(response.translated_texts, ["Bonjour"]);
        assert_eq!(response.provider, TranslatorProvider::OpenAiCompatible);
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/v1/chat/completions");
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some("Bearer openai-key")
        );
        assert_eq!(user_json["texts"], json!(["Hello"]));
        assert_eq!(user_json["target"], "fr");
    }

    #[tokio::test]
    #[ignore = "requires loopback listener; run through scripts/verify_translator_providers.py"]
    async fn deepl_provider_translates_through_mock_http_server() {
        let server = MockServer::spawn(r#"{"translations":[{"text":"Bonjour"}]}"#);
        let mut config = AppConfig::default().translator.deepl;
        config.base_url = server.endpoint("v2");
        config.api_key = Some("deepl-key".to_owned());

        let translator = DeepLTranslator::new(config, Client::new());
        let response = translator
            .translate(sample_request())
            .await
            .expect("deepl translation");
        let request = server.take_request();
        let body: Value = serde_json::from_str(&request.body).expect("deepl request JSON");

        assert_eq!(response.translated_texts, ["Bonjour"]);
        assert_eq!(response.provider, TranslatorProvider::DeepL);
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/v2/translate");
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some("DeepL-Auth-Key deepl-key")
        );
        assert_eq!(body["text"], json!(["Hello"]));
        assert_eq!(body["source_lang"], "EN");
        assert_eq!(body["target_lang"], "FR");
    }

    #[tokio::test]
    #[ignore = "requires loopback listener; run through scripts/verify_translator_providers.py"]
    async fn google_provider_translates_through_mock_http_server() {
        let server =
            MockServer::spawn(r#"{"data":{"translations":[{"translatedText":"Bonjour"}]}}"#);
        let mut config = AppConfig::default().translator.google;
        config.base_url = server.endpoint("language/translate/v2");
        config.api_key = Some("google-key".to_owned());

        let translator = GoogleTranslator::new(config, Client::new());
        let response = translator
            .translate(sample_request())
            .await
            .expect("google translation");
        let request = server.take_request();
        let body: Value = serde_json::from_str(&request.body).expect("google request JSON");

        assert_eq!(response.translated_texts, ["Bonjour"]);
        assert_eq!(response.provider, TranslatorProvider::Google);
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/language/translate/v2");
        assert_eq!(body["q"], json!(["Hello"]));
        assert_eq!(body["source"], "en");
        assert_eq!(body["target"], "fr");
        assert_eq!(body["key"], "google-key");
    }

    #[tokio::test]
    #[ignore = "requires loopback listener; run through scripts/verify_translator_providers.py"]
    async fn local_http_provider_translates_through_mock_http_server() {
        let server = MockServer::spawn(r#"{"translated_texts":["Bonjour"]}"#);
        let config = LocalHttpConfig {
            endpoint: server.endpoint("translate"),
        };

        let translator = LocalHttpTranslator::new(config, Client::new());
        let response = translator
            .translate(sample_request())
            .await
            .expect("local http translation");
        let request = server.take_request();
        let body: TranslateRequest =
            serde_json::from_str(&request.body).expect("local http request JSON");

        assert_eq!(response.translated_texts, ["Bonjour"]);
        assert_eq!(response.provider, TranslatorProvider::LocalHttp);
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/translate");
        assert_eq!(body, sample_request());
    }

    fn sample_request() -> TranslateRequest {
        TranslateRequest {
            texts: vec!["Hello".to_owned()],
            source: Some(Lang("en".to_owned())),
            target: Lang("fr".to_owned()),
        }
    }
}
