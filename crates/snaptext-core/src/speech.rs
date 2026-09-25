//! 桌面端只连接 SnapText Cloud；厂商模型和密钥不进入本地配置。
use crate::{
    Error, Result,
    cloud_auth::{CloudDeviceIdentity, join_cloud_url},
    config::SnapTextCloudConfig,
    speech_sse::SseDecoder,
    translate::{ensure_snaptext_cloud_registered, system_version},
};
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, pin::Pin, time::Duration};

/// 独立的云端朗读请求，不受翻译 provider 选择影响。
#[derive(Clone, Serialize, Deserialize)]
pub struct SpeechRequest {
    /// 待朗读文本，不实现 Debug 以免日志泄漏。
    pub text: String,
    /// SnapText 语言代码。
    pub language: String,
    /// 已选择的云端音色。
    pub voice: Option<String>,
    /// 合成参考语速。
    pub rate: f32,
    /// 英美口音偏好。
    pub english_accent: Option<String>,
}
/// 服务端提供的可选音色。
#[derive(Clone, Serialize, Deserialize)]
pub struct SpeechVoice {
    /// 音色标识。
    pub id: String,
    /// 展示名称。
    pub name: String,
    /// 适用语言。
    pub language: String,
}
/// 无厂商凭据的语音能力。
#[derive(Clone, Serialize, Deserialize)]
pub struct SpeechCapabilities {
    /// 服务是否可用。
    pub enabled: bool,
    /// 供应商展示标识。
    pub provider: String,
    /// 支持的规范语言代码。
    pub languages: Vec<String>,
    /// 音色目录。
    pub voices: Vec<SpeechVoice>,
    /// 按语言选择的默认音色。
    pub default_voices: BTreeMap<String, String>,
    /// 请求字符上限。
    pub max_chars_per_request: usize,
}
/// 语音专用字符配额。
#[derive(Clone, Serialize, Deserialize)]
pub struct SpeechQuota {
    /// 当日字符额度。
    pub free_chars_today: u64,
    /// 已计入的尝试字符数。
    pub used_chars_today: u64,
    /// 剩余字符数。
    pub remaining_chars_today: u64,
    /// UTC 重置时间。
    pub reset_at: String,
}
/// cloud SSE 转成强类型 IPC 事件，防止直接转发厂商任意 JSON。
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SpeechEvent {
    /// 音频格式及初始配额。
    Meta {
        /// 云请求标识。
        request_id: String,
        /// 供应商标识。
        provider: String,
        /// 固定为 pcm16le。
        format: String,
        /// PCM 采样率。
        sample_rate: u32,
        /// PCM 声道数。
        channels: u8,
        /// 独立语音配额。
        quota: SpeechQuota,
    },
    /// 一段有序 PCM 数据。
    Audio {
        /// 云请求标识。
        request_id: String,
        /// 从零开始的分片序号。
        sequence: u64,
        /// Base64 编码的 PCM16LE 音频。
        data: String,
    },
    /// 网络传输完成，不代表本地音频队列已播放完。
    Done {
        /// 云请求标识。
        request_id: String,
        /// 最终语音配额。
        quota: SpeechQuota,
    },
    /// 已开始的流出现错误。
    Error {
        /// 云请求标识。
        request_id: String,
        /// 稳定的错误码。
        code: String,
        /// cloud 已脱敏的用户提示。
        message: String,
    },
}
impl SpeechEvent {
    /// 取得事件关联的云请求，防止不同会话的帧混入。
    fn request_id(&self) -> &str {
        match self {
            Self::Meta { request_id, .. }
            | Self::Audio { request_id, .. }
            | Self::Done { request_id, .. }
            | Self::Error { request_id, .. } => request_id,
        }
    }
}
/// 可被取消的按需事件流。
pub type SpeechStream = Pin<Box<dyn Stream<Item = Result<SpeechEvent>> + Send>>;

/// 获取 cloud 语音能力，独立于翻译开关。
pub async fn capabilities(config: &SnapTextCloudConfig) -> Result<SpeechCapabilities> {
    let response = send_signed(
        config,
        reqwest::Method::GET,
        "v1/speech/capabilities",
        Vec::new(),
    )
    .await?;
    let bytes = bounded_body(response).await?;
    serde_json::from_slice(&bytes).map_err(|_| Error::Speech("云端语音能力响应无效".into()))
}
/// 拉取当前设备的语音配额，供设置页显示。
pub async fn quota(config: &SnapTextCloudConfig) -> Result<SpeechQuota> {
    let response = send_signed(config, reqwest::Method::GET, "v1/quota", Vec::new()).await?;
    let value: serde_json::Value = serde_json::from_slice(&bounded_body(response).await?)
        .map_err(|_| Error::Speech("云端配额响应无效".into()))?;
    serde_json::from_value(value.get("speech").cloned().unwrap_or_default())
        .map_err(|_| Error::Speech("服务端尚未提供语音配额".into()))
}
/// 发送一次付费合成请求；连接超时不自动重试，以免重复扣费。
pub async fn synthesize(
    config: &SnapTextCloudConfig,
    request: &SpeechRequest,
) -> Result<SpeechStream> {
    let body = serde_json::to_vec(request).map_err(|_| Error::Speech("无法编码语音请求".into()))?;
    let response = send_signed(config, reqwest::Method::POST, "v1/speech", body).await?;
    if !response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"))
    {
        return Err(Error::Speech("云端没有返回语音流".into()));
    }
    Ok(Box::pin(async_stream::try_stream! {
        let mut body = response.bytes_stream(); let mut decoder = SseDecoder::default();
        let mut cloud_id: Option<String> = None; let mut next_sequence = 0u64; let mut total = 0usize; let mut terminal = false;
        'stream: while let Some(bytes) = body.next().await {
            let bytes = bytes.map_err(|_| Error::Speech("云端语音连接中断".into()))?;
            for message in decoder.push(&bytes)? {
                if !matches!(message.event.as_str(), "meta" | "audio" | "done" | "error") { continue; }
                let mut value: serde_json::Value = serde_json::from_str(&message.data).map_err(|_| Error::Speech("语音流事件无效".into()))?;
                value.as_object_mut().ok_or_else(|| Error::Speech("语音流事件无效".into()))?.insert("type".into(), message.event.into());
                let event: SpeechEvent = serde_json::from_value(value).map_err(|_| Error::Speech("语音事件字段无效".into()))?;
                if let SpeechEvent::Meta { request_id, format, sample_rate, channels, .. } = &event {
                    if cloud_id.is_some() || format != "pcm16le" || *sample_rate != 24000 || *channels != 1 { Err(Error::Speech("不支持的语音流格式".into()))?; }
                    cloud_id = Some(request_id.clone());
                }
                if cloud_id.as_deref() != Some(event.request_id()) { Err(Error::Speech("语音流会话不匹配".into()))?; }
                if let SpeechEvent::Audio { sequence, data, .. } = &event {
                    use base64::Engine;
                    if *sequence != next_sequence || data.len() > 64_000 { Err(Error::Speech("语音分片顺序或大小无效".into()))?; }
                    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| Error::Speech("语音数据无效".into()))?;
                    total += bytes.len(); if total > 64 * 1024 * 1024 { Err(Error::Speech("语音超过大小限制".into()))?; }
                    next_sequence += 1;
                }
                terminal = matches!(event, SpeechEvent::Done { .. } | SpeechEvent::Error { .. });
                if matches!(event, SpeechEvent::Done { .. }) && (total == 0 || !total.is_multiple_of(2)) { Err(Error::Speech("语音数据不完整".into()))?; }
                yield event;
                if terminal { break 'stream; }
            }
        }
        if !terminal { Err(Error::Speech("语音流提前中断，请重试".into()))?; }
    }))
}
/// 共用本地设备身份签名，仅在服务端确认未注册时重新注册一次。
async fn send_signed(
    config: &SnapTextCloudConfig,
    method: reqwest::Method,
    path: &str,
    body: Vec<u8>,
) -> Result<reqwest::Response> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(125))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| Error::Speech("无法初始化云连接".into()))?;
    let identity = CloudDeviceIdentity::load_or_create(config)?;
    tokio::time::timeout(
        Duration::from_secs(20),
        ensure_snaptext_cloud_registered(config, &client, &identity, false),
    )
    .await
    .map_err(|_| Error::Speech("云设备注册超时".into()))??;
    let endpoint = join_cloud_url(&config.endpoint, path)?;
    for attempt in 0..2 {
        let signed = identity.sign_json_request(method.as_str(), &endpoint, &body)?;
        let response = tokio::time::timeout(
            Duration::from_secs(125),
            client
                .request(method.clone(), endpoint.clone())
                .header("content-type", "application/json")
                .header("x-snaptext-device", identity.device_id())
                .header("x-snaptext-timestamp", signed.timestamp_ms)
                .header("x-snaptext-nonce", signed.nonce)
                .header("x-snaptext-body-sha256", signed.body_sha256)
                .header("x-snaptext-signature", signed.signature)
                .header("x-snaptext-version", env!("CARGO_PKG_VERSION"))
                .header("x-snaptext-platform", std::env::consts::OS)
                .header("x-snaptext-system-version", system_version())
                .body(body.clone())
                .send(),
        )
        .await
        .map_err(|_| Error::Speech("云端语音请求超时".into()))?
        .map_err(|_| Error::Speech("无法连接云端语音服务".into()))?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status().as_u16();
        let value: serde_json::Value =
            serde_json::from_slice(&bounded_body(response).await?).unwrap_or_default();
        if attempt == 0
            && value.pointer("/error/code").and_then(|v| v.as_str())
                == Some("device_not_registered")
        {
            tokio::time::timeout(
                Duration::from_secs(20),
                ensure_snaptext_cloud_registered(config, &client, &identity, true),
            )
            .await
            .map_err(|_| Error::Speech("云设备注册超时".into()))??;
            continue;
        }
        return Err(Error::Speech(
            value
                .pointer("/error/message")
                .and_then(|v| v.as_str())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("云端语音请求失败（HTTP {status}）")),
        ));
    }
    Err(Error::Speech("云端语音设备认证失败".into()))
}
/// 小型 JSON 响应保持上限，避免把代理错误页或过大响应传入 UI。
async fn bounded_body(mut response: reqwest::Response) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Error::Speech("云端响应读取失败".into()))?
    {
        if output.len() + chunk.len() > 64 * 1024 {
            return Err(Error::Speech("云端响应过大".into()));
        }
        output.extend_from_slice(&chunk);
    }
    Ok(output)
}
