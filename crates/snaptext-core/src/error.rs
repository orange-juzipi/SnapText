use serde::Serialize;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum Error {
    #[error("OCR failed: {0}")]
    Ocr(String),
    #[error("translation failed: {0}")]
    Translate(String),
    #[error("screenshot failed: {0}")]
    Screenshot(String),
    #[error("selection failed: {0}")]
    Selection(String),
    #[error("history failed: {0}")]
    History(String),
    #[error("config failed: {0}")]
    Config(String),
    #[error("image failed: {0}")]
    Image(String),
    #[error("io failed: {0}")]
    Io(String),
}

impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<serde_yaml::Error> for Error {
    fn from(value: serde_yaml::Error) -> Self {
        Self::Config(value.to_string())
    }
}

impl From<rusqlite::Error> for Error {
    fn from(value: rusqlite::Error) -> Self {
        Self::History(value.to_string())
    }
}

impl From<image::ImageError> for Error {
    fn from(value: image::ImageError) -> Self {
        Self::Image(value.to_string())
    }
}

impl From<reqwest::Error> for Error {
    fn from(value: reqwest::Error) -> Self {
        Self::Translate(value.to_string())
    }
}

impl From<ort::Error> for Error {
    fn from(value: ort::Error) -> Self {
        Self::Ocr(value.to_string())
    }
}
