//! 所有窗口共用朗读所有权；音频通过专属 Channel 传递，不广播敏感数据。
#![cfg_attr(test, allow(dead_code))]

use crate::state::AppState;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use snaptext_core::{
    Error, Result,
    config::{SnapTextCloudConfig, SpeechAudioFormat},
    speech::{SpeechCapabilities, SpeechEvent, SpeechQuota, SpeechRequest},
};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, State, WebviewWindow, ipc::Channel};
use tokio::sync::{Notify, watch};
use url::Url;

const MAX_LOCAL_SPEECH_TEXT_CHARS: usize = 8_000;
const MAX_LOCAL_SPEECH_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

/// 应用级单会话状态，覆盖系统朗读、词典音频和云端朗读。
#[derive(Default)]
pub(crate) struct SpeechPlayback {
    /// 当前获得播放权的会话。
    current: Mutex<Option<PlaybackSession>>,
}
/// 不包含文本或音频的所有权与流量控制数据。
#[derive(Clone)]
struct PlaybackSession {
    /// 客户端生成的会话标识。
    id: String,
    /// 所属窗口标签。
    owner: String,
    /// 取消进行中的网络读取和 ACK 等待。
    cancel: watch::Sender<bool>,
    /// 有限缓冲消费完成时唤醒 Rust。
    ready: Arc<Notify>,
    /// 已发送的帧数量。
    delivered: Arc<AtomicU64>,
    /// 已确认的帧数量。
    acknowledged: Arc<AtomicU64>,
    /// 同一会话只允许启动一次付费请求。
    started: bool,
}
/// 跨窗口停止事件仅包含本地会话标识。
#[derive(Clone, Serialize)]
struct StoppedSpeech {
    /// 必须与接收窗口当前会话一致才停止。
    session_id: String,
}
/// 发给调用窗口的强类型音频消息。
#[derive(Clone, Serialize)]
pub(crate) struct SpeechChannelMessage {
    /// 本地播放会话标识。
    session_id: String,
    /// 已解析和验证的 cloud 事件。
    event: SpeechEvent,
}

/// 用户本机保存的 OpenAI-compatible TTS 调用参数。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSpeechRequest {
    /// 待合成文本，不写入日志。
    text: String,
    /// 完整的本地或用户自管 TTS endpoint。
    endpoint: String,
    /// 可选的本地服务 API key。
    api_key: Option<String>,
    /// OpenAI-compatible TTS 模型标识。
    model: String,
    /// 服务端音色标识。
    voice: String,
    /// 合成语速。
    rate: f32,
    /// 请求的音频容器格式。
    response_format: SpeechAudioFormat,
}

/// 经过大小和内容类型限制的完整本地音频。
#[derive(Serialize)]
pub(crate) struct LocalSpeechAudio {
    /// Base64 编码的音频响应。
    audio_base64: String,
    /// 与请求格式对应的稳定 MIME 类型。
    content_type: &'static str,
}

/// OpenAI-compatible `/v1/audio/speech` 请求体。
#[derive(Serialize)]
struct OpenAiSpeechBody<'a> {
    /// TTS 模型标识。
    model: &'a str,
    /// 待合成文本。
    input: &'a str,
    /// 服务端音色标识。
    voice: &'a str,
    /// 合成语速。
    speed: f32,
    /// 返回的音频格式。
    response_format: SpeechAudioFormat,
}

/// 取消网络读取并通知所属窗口释放音频节点。
fn stop_session(app: &AppHandle, session: PlaybackSession) {
    session.cancel.send_replace(true);
    session.ready.notify_waiters();
    let _ = app.emit_to(
        &session.owner,
        "snaptext://speech-stopped",
        StoppedSpeech {
            session_id: session.id,
        },
    );
}
/// 原生录音、配置停用和窗口关闭都通过同一入口停止播放。
pub(crate) fn stop_for_window(app: &AppHandle, state: &AppState, owner: Option<&str>) {
    if let Ok(mut current) = state.speech_playback.current.lock()
        && current
            .as_ref()
            .is_some_and(|session| owner.is_none_or(|owner| session.owner == owner))
        && let Some(session) = current.take()
    {
        stop_session(app, session);
    }
}
/// 使用相同设备身份及本地调试覆盖，不受当前翻译来源或翻译开关影响。
fn cloud_config(state: &AppState) -> Result<SnapTextCloudConfig> {
    let config = state
        .config
        .read()
        .map_err(|_| Error::Speech("无法读取语音配置".into()))?;
    let mut translator = config.translator.clone();
    crate::apply_snaptext_cloud_runtime_override(&mut translator)?;
    Ok(translator.snaptext_cloud)
}
/// 注册全局播放权；新会话立即使旧窗口和旧请求失效。
#[tauri::command]
pub(crate) fn claim_speech(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<()> {
    if !(16..=128).contains(&session_id.len())
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(Error::Speech("无效的朗读会话".into()));
    }
    let mut current = state
        .speech_playback
        .current
        .lock()
        .map_err(|_| Error::Speech("无法取得朗读状态".into()))?;
    if let Some(old) = current.take() {
        stop_session(&app, old);
    }
    *current = Some(PlaybackSession {
        id: session_id,
        owner: window.label().into(),
        cancel: watch::channel(false).0,
        ready: Arc::new(Notify::new()),
        delivered: Arc::new(AtomicU64::new(0)),
        acknowledged: Arc::new(AtomicU64::new(0)),
        started: false,
    });
    Ok(())
}
/// 仅取消本窗口对应会话，迟到的停止操作不会影响新的朗读。
#[tauri::command]
pub(crate) fn cancel_speech(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    stream_only: Option<bool>,
) -> Result<()> {
    let mut current = state
        .speech_playback
        .current
        .lock()
        .map_err(|_| Error::Speech("无法读取朗读状态".into()))?;
    if current
        .as_ref()
        .is_some_and(|session| session.id == session_id && session.owner == window.label())
    {
        if stream_only == Some(true) {
            if let Some(session) = current.as_ref() {
                session.cancel.send_replace(true);
            }
        } else if let Some(session) = current.take() {
            stop_session(&app, session);
        }
    }
    Ok(())
}
/// 前端缓冲未超过上限时确认一帧，逐帧 ACK 防止 IPC 队列无限增长。
#[tauri::command]
pub(crate) fn acknowledge_speech(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    sequence: u64,
) -> Result<()> {
    let current = state
        .speech_playback
        .current
        .lock()
        .map_err(|_| Error::Speech("无法读取朗读状态".into()))?;
    let Some(session) = current
        .as_ref()
        .filter(|session| session.id == session_id && session.owner == window.label())
    else {
        return Ok(());
    };
    let next = sequence
        .checked_add(1)
        .ok_or_else(|| Error::Speech("无效的音频序号".into()))?;
    if session.delivered.load(Ordering::Acquire) != next {
        return Err(Error::Speech("无效的音频确认".into()));
    }
    if session
        .acknowledged
        .compare_exchange(sequence, next, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        session.ready.notify_one();
    }
    Ok(())
}
/// 获取云端能力供音色选择使用，不发送朗读文本。
#[tauri::command]
pub(crate) async fn get_speech_capabilities(
    state: State<'_, AppState>,
) -> Result<SpeechCapabilities> {
    snaptext_core::speech::capabilities(&cloud_config(state.inner())?).await
}
/// 获取独立语音剩余额度。
#[tauri::command]
pub(crate) async fn get_speech_quota(state: State<'_, AppState>) -> Result<SpeechQuota> {
    snaptext_core::speech::quota(&cloud_config(state.inner())?).await
}

/// 使用用户本机配置的 OpenAI-compatible endpoint 合成完整音频。
#[tauri::command]
pub(crate) async fn start_local_speech(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    request: LocalSpeechRequest,
) -> Result<LocalSpeechAudio> {
    let session = {
        let mut current = state
            .speech_playback
            .current
            .lock()
            .map_err(|_| Error::Speech("无法读取朗读状态".into()))?;
        let session = current
            .as_mut()
            .filter(|session| {
                session.id == session_id && session.owner == window.label() && !session.started
            })
            .ok_or_else(|| Error::Speech("朗读会话已失效".into()))?;
        session.started = true;
        session.clone()
    };
    if request.text.trim().is_empty() {
        return Err(Error::Speech("没有可播放的文本".into()));
    }
    if request.text.chars().count() > MAX_LOCAL_SPEECH_TEXT_CHARS {
        return Err(Error::Speech("自定义 AI 朗读文本过长".into()));
    }
    let endpoint = Url::parse(request.endpoint.trim())
        .map_err(|_| Error::Speech("自定义 AI 语音地址无效".into()))?;
    if !matches!(endpoint.scheme(), "http" | "https")
        || endpoint.host_str().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
    {
        return Err(Error::Speech(
            "自定义 AI 语音地址必须是 HTTP(S) endpoint".into(),
        ));
    }
    let model = request.model.trim();
    let voice = request.voice.trim();
    if model.is_empty() || voice.is_empty() {
        return Err(Error::Speech("请填写自定义 AI 语音模型和音色".into()));
    }
    if !request.rate.is_finite() {
        return Err(Error::Speech("自定义 AI 语速无效".into()));
    }
    let body = OpenAiSpeechBody {
        model,
        input: &request.text,
        voice,
        speed: request.rate.clamp(0.25, 3.0),
        response_format: request.response_format,
    };
    let body = serde_json::to_vec(&body)
        .map_err(|_| Error::Speech("无法编码自定义 AI 语音请求".into()))?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| Error::Speech("无法初始化自定义 AI 语音连接".into()))?;
    let mut cancel = session.cancel.subscribe();
    if *cancel.borrow() {
        return Err(Error::Speech("朗读已停止".into()));
    }
    let mut builder = client
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "audio/wav, audio/mpeg")
        .body(body);
    if let Some(api_key) = request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
    {
        builder = builder.bearer_auth(api_key);
    }
    let response = tokio::select! {
        _ = cancel.changed() => return Err(Error::Speech("朗读已停止".into())),
        result = builder.send() => result.map_err(|_| Error::Speech("无法连接自定义 AI 语音服务".into()))?,
    };
    let status = response.status();
    if !status.is_success() {
        return Err(Error::Speech(format!(
            "自定义 AI 语音服务返回 HTTP {status}"
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_LOCAL_SPEECH_RESPONSE_BYTES as u64)
    {
        return Err(Error::Speech("自定义 AI 语音响应超过大小限制".into()));
    }
    let response_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim();
    let expected_type = match request.response_format {
        SpeechAudioFormat::Wav => ["audio/wav", "audio/x-wav", "application/octet-stream"],
        SpeechAudioFormat::Mp3 => ["audio/mpeg", "audio/mp3", "application/octet-stream"],
    };
    if !expected_type.contains(&response_type) {
        return Err(Error::Speech("自定义 AI 语音服务未返回音频".into()));
    }
    let mut audio = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = tokio::select! {
        _ = cancel.changed() => return Err(Error::Speech("朗读已停止".into())),
        chunk = stream.next() => chunk,
    } {
        let chunk = chunk.map_err(|_| Error::Speech("读取自定义 AI 语音失败".into()))?;
        if audio.len().saturating_add(chunk.len()) > MAX_LOCAL_SPEECH_RESPONSE_BYTES {
            return Err(Error::Speech("自定义 AI 语音响应超过大小限制".into()));
        }
        audio.extend_from_slice(&chunk);
    }
    if audio.is_empty() {
        return Err(Error::Speech("自定义 AI 语音服务返回了空音频".into()));
    }
    let content_type = match request.response_format {
        SpeechAudioFormat::Wav => "audio/wav",
        SpeechAudioFormat::Mp3 => "audio/mpeg",
    };
    Ok(LocalSpeechAudio {
        audio_base64: STANDARD.encode(audio),
        content_type,
    })
}

/// 流式传递到调用窗口，停止或断开时丢弃 HTTP 流并释放上游。
#[tauri::command]
pub(crate) async fn start_cloud_speech(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    request: SpeechRequest,
    channel: Channel<SpeechChannelMessage>,
) -> Result<()> {
    let session = {
        let mut current = state
            .speech_playback
            .current
            .lock()
            .map_err(|_| Error::Speech("无法读取朗读状态".into()))?;
        let session = current
            .as_mut()
            .filter(|session| {
                session.id == session_id && session.owner == window.label() && !session.started
            })
            .ok_or_else(|| Error::Speech("朗读会话已失效".into()))?;
        session.started = true;
        session.clone()
    };
    let mut cancel = session.cancel.subscribe();
    if *cancel.borrow() {
        return Ok(());
    }
    let config = cloud_config(state.inner())?;
    let mut stream = tokio::select! { _ = cancel.changed() => return Ok(()), result = snaptext_core::speech::synthesize(&config, &request) => result? };
    loop {
        let item =
            tokio::select! { _ = cancel.changed() => return Ok(()), item = stream.next() => item };
        let Some(event) = item else {
            return Ok(());
        };
        let event = event?;
        let sequence = match &event {
            SpeechEvent::Audio { sequence, .. } => Some(*sequence),
            _ => None,
        };
        if let Some(sequence) = sequence {
            session.delivered.store(sequence + 1, Ordering::Release);
        }
        channel
            .send(SpeechChannelMessage {
                session_id: session_id.clone(),
                event,
            })
            .map_err(|_| Error::Speech("朗读窗口已关闭".into()))?;
        if let Some(sequence) = sequence {
            let ready = async {
                loop {
                    let notified = session.ready.notified();
                    if session.acknowledged.load(Ordering::Acquire) > sequence {
                        break;
                    }
                    notified.await;
                }
            };
            tokio::select! {
                _ = cancel.changed() => return Ok(()),
                result = tokio::time::timeout(Duration::from_secs(30), ready) => result.map_err(|_| Error::Speech("音频播放窗口响应超时".into()))?,
            }
        }
    }
}
