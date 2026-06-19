//! Core business layer for SnapText.
//!
//! This crate intentionally avoids any Tauri or GUI dependency so OCR,
//! translation, config, and history behavior can be tested in isolation.

pub mod config;
pub mod error;
pub mod history;
pub mod hotkey;
pub mod ocr;
pub mod pipeline;
pub mod screenshot;
pub mod selection;
pub mod translate;

pub use error::{Error, Result};
