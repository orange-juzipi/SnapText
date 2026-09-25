//! 有界 SSE 解码器：只在完整 UTF-8 行到达后解码。
use crate::{Error, Result};

/// 一条完整 SSE 消息。
pub struct SseMessage {
    /// 事件名称，省略时为 message。
    pub event: String,
    /// 多行 data 字段拼接后的内容。
    pub data: String,
}
/// 跨 TCP 分片保存不完整行和事件数据。
#[derive(Default)]
pub struct SseDecoder {
    /// 尚未遇到换行的原始字节。
    pending: Vec<u8>,
    /// 当前事件名称。
    event: String,
    /// 当前事件的 data 行。
    data: Vec<String>,
    /// 当前事件累计字节数。
    size: usize,
}
impl SseDecoder {
    /// 接收网络分片并产出完整事件，单事件不超过 2 MiB。
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<SseMessage>> {
        let mut messages = Vec::new();
        for byte in bytes {
            self.size += 1;
            if self.size > 2 * 1024 * 1024 {
                return Err(Error::Speech("speech SSE frame too large".into()));
            }
            if *byte != b'\n' {
                self.pending.push(*byte);
                continue;
            }
            let line = std::str::from_utf8(&self.pending)
                .map_err(|_| Error::Speech("speech SSE invalid UTF-8".into()))?
                .trim_end_matches('\r');
            if line.is_empty() {
                if !self.data.is_empty() {
                    messages.push(SseMessage {
                        event: if self.event.is_empty() {
                            "message".into()
                        } else {
                            std::mem::take(&mut self.event)
                        },
                        data: self.data.join("\n"),
                    });
                }
                self.event.clear();
                self.data.clear();
                self.size = 0;
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data
                    .push(data.strip_prefix(' ').unwrap_or(data).to_owned());
            } else if let Some(event) = line.strip_prefix("event:") {
                self.event = event.trim().to_owned();
            }
            self.pending.clear();
        }
        Ok(messages)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    /// 验证逐字节输入不会截断中文，且能处理 CRLF 和多行 data。
    #[test]
    fn handles_fragmented_unicode_and_multiline_events() {
        let mut decoder = SseDecoder::default();
        let mut output = Vec::new();
        for byte in "event: audio\r\ndata: 冰糖\r\ndata: second\r\n\r\n".as_bytes() {
            output.extend(decoder.push(&[*byte]).unwrap());
        }
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].event, "audio");
        assert_eq!(output[0].data, "冰糖\nsecond");
    }
    /// 验证无终止符的恶意帧有确定的内存上限。
    #[test]
    fn rejects_unbounded_frames() {
        assert!(
            SseDecoder::default()
                .push(&vec![b'x'; 2 * 1024 * 1024 + 1])
                .is_err()
        );
    }
}
