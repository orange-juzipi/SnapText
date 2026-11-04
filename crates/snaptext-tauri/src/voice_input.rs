use snaptext_core::{Error, Result};

#[cfg(target_os = "macos")]
use std::{
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2::{AnyThread, rc::Retained};
#[cfg(target_os = "macos")]
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
#[cfg(target_os = "macos")]
use objc2_avf_audio::{AVAudioEngine, AVAudioNode, AVAudioPCMBuffer, AVAudioTime};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSLocale, NSString};
#[cfg(target_os = "macos")]
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionRequest, SFSpeechRecognitionResult,
    SFSpeechRecognitionTask, SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
};
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "macos")]
use crate::{
    MAIN_WINDOW_LABEL,
    events::{VOICE_INPUT_PARTIAL_EVENT, VoiceInputPartialPayload},
    state::AppState,
};

#[cfg(target_os = "macos")]
const SPEECH_AUTH_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(target_os = "macos")]
const MICROPHONE_AUTH_TIMEOUT: Duration = Duration::from_secs(30);

#[cfg(target_os = "macos")]
pub(crate) struct VoiceInputSession {
    /// 当前运行的本机音频采集引擎。
    engine: Retained<AVAudioEngine>,
    /// 接收麦克风缓冲区的语音识别请求。
    request: Retained<SFSpeechAudioBufferRecognitionRequest>,
    /// 保持语音识别任务存活，直到会话停止。
    task: Retained<SFSpeechRecognitionTask>,
    /// 保持识别结果回调存活，直到会话停止。
    result_handler: RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut objc2_foundation::NSError)>,
    /// 保持音频采集回调存活，直到从输入节点移除。
    tap_block:
        RcBlock<dyn Fn(core::ptr::NonNull<AVAudioPCMBuffer>, core::ptr::NonNull<AVAudioTime>)>,
    /// 回调线程共享的转写文本和错误信息。
    state: Arc<Mutex<VoiceInputRuntimeState>>,
}

// Tauri managed state must be Send + Sync. The session is only accessed behind
// AppState's mutex, and Objective-C owns the callback threads while these
// retained handles are kept alive until stop.
#[cfg(target_os = "macos")]
unsafe impl Send for VoiceInputSession {}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct VoiceInputRuntimeState {
    /// 最近一次部分或最终转写文本。
    latest_text: String,
    /// 最近一次已确认完成的转写文本。
    latest_final_text: String,
    /// 识别框架报告的错误，在停止时返回给调用方。
    error: Option<String>,
}

/// 授权后启动麦克风采集和系统语音识别，并保存会话资源。
#[cfg(target_os = "macos")]
pub(crate) fn start_voice_input(state: &AppState, app: AppHandle, locale: String) -> Result<()> {
    ensure_speech_authorized()?;
    ensure_microphone_authorized()?;
    let mut current = state
        .voice_input
        .lock()
        .map_err(|err| Error::Speech(err.to_string()))?;
    if current.is_some() {
        return Err(Error::Speech("voice input is already recording".to_owned()));
    }

    let locale_identifier = NSString::from_str(&locale);
    let ns_locale = NSLocale::initWithLocaleIdentifier(NSLocale::alloc(), &locale_identifier);
    let recognizer =
        unsafe { SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &ns_locale) }
            .ok_or_else(|| {
                Error::Speech("speech recognizer is not available for this language".to_owned())
            })?;
    if !unsafe { recognizer.isAvailable() } {
        return Err(Error::Speech(
            "speech recognizer is currently unavailable".to_owned(),
        ));
    }

    let engine = unsafe { AVAudioEngine::init(AVAudioEngine::alloc()) };
    let input_node = unsafe { engine.inputNode() };
    let input_node: Retained<AVAudioNode> = input_node.into_super().into_super();
    let input_format = unsafe { input_node.outputFormatForBus(0) };
    let request = unsafe {
        SFSpeechAudioBufferRecognitionRequest::init(SFSpeechAudioBufferRecognitionRequest::alloc())
    };
    let request_for_tap = request.clone();
    let request_for_task: Retained<SFSpeechRecognitionRequest> = request.clone().into_super();
    unsafe { request_for_task.setShouldReportPartialResults(true) };

    let runtime_state = Arc::new(Mutex::new(VoiceInputRuntimeState::default()));
    let handler_state = Arc::clone(&runtime_state);
    let handler_app = app.clone();
    let result_handler = RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, error: *mut objc2_foundation::NSError| {
            if let Some(error) = unsafe { error.as_ref() } {
                if let Ok(mut state) = handler_state.lock() {
                    state.error = Some(error.to_string());
                }
                return;
            }
            let Some(result) = (unsafe { result.as_ref() }) else {
                return;
            };
            let transcription = unsafe { result.bestTranscription() };
            let formatted = unsafe { transcription.formattedString() };
            let text = ns_string_to_string(&formatted).trim().to_owned();
            if text.is_empty() {
                return;
            }
            let final_result = unsafe { result.isFinal() };
            if let Ok(mut state) = handler_state.lock() {
                state.latest_text = text.clone();
                if final_result {
                    state.latest_final_text = text.clone();
                }
            }
            let payload = VoiceInputPartialPayload { text, final_result };
            if let Err(err) =
                handler_app.emit_to(MAIN_WINDOW_LABEL, VOICE_INPUT_PARTIAL_EVENT, payload)
            {
                tracing::warn!(error = %err, "failed to emit voice input partial text");
            }
        },
    );
    let task = unsafe {
        recognizer.recognitionTaskWithRequest_resultHandler(&request_for_task, &result_handler)
    };

    // 保持 tap block 存活到 stop；回调线程由 AVAudioEngine 管理。
    let tap_block = RcBlock::new(
        move |buffer: core::ptr::NonNull<AVAudioPCMBuffer>,
              _when: core::ptr::NonNull<AVAudioTime>| {
            unsafe { request_for_tap.appendAudioPCMBuffer(buffer.as_ref()) };
        },
    );
    unsafe {
        input_node.installTapOnBus_bufferSize_format_block(
            0,
            1024,
            Some(&input_format),
            RcBlock::as_ptr(&tap_block),
        );
        engine.prepare();
        engine
            .startAndReturnError()
            .map_err(|err| Error::Speech(err.to_string()))?;
    }

    *current = Some(VoiceInputSession {
        engine,
        request,
        task,
        result_handler,
        tap_block,
        state: runtime_state,
    });
    Ok(())
}

/// 在尚不支持语音输入的平台返回明确错误。
#[cfg(not(target_os = "macos"))]
pub(crate) fn start_voice_input(
    _state: &crate::state::AppState,
    _app: tauri::AppHandle,
    _locale: String,
) -> Result<()> {
    Err(Error::Speech(
        "voice input is only supported on macOS".to_owned(),
    ))
}

/// 停止采集并返回会话中最新的转写文本。
#[cfg(target_os = "macos")]
pub(crate) async fn stop_voice_input(state: &AppState) -> Result<String> {
    let session = {
        let mut current = state
            .voice_input
            .lock()
            .map_err(|err| Error::Speech(err.to_string()))?;
        current
            .take()
            .ok_or_else(|| Error::Speech("voice input is not recording".to_owned()))?
    };

    unsafe {
        session.engine.inputNode().removeTapOnBus(0);
        session.engine.stop();
        session.request.endAudio();
    }
    drop(session.tap_block);
    drop(session.result_handler);
    drop(session.task);

    let state = session
        .state
        .lock()
        .map_err(|err| Error::Speech(err.to_string()))?;
    if let Some(error) = &state.error {
        return Err(Error::Speech(error.clone()));
    }
    let text = if state.latest_final_text.trim().is_empty() {
        state.latest_text.trim()
    } else {
        state.latest_final_text.trim()
    };
    Ok(text.to_owned())
}

/// 在尚不支持语音输入的平台返回明确错误。
#[cfg(not(target_os = "macos"))]
pub(crate) async fn stop_voice_input(_state: &crate::state::AppState) -> Result<String> {
    Err(Error::Speech(
        "voice input is only supported on macOS".to_owned(),
    ))
}

/// 仅在系统尚未询问用户时请求语音识别授权。
#[cfg(target_os = "macos")]
fn ensure_speech_authorized() -> Result<()> {
    let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
    if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
        return Ok(());
    }
    if status != SFSpeechRecognizerAuthorizationStatus::NotDetermined {
        return Err(Error::Speech(speech_authorization_error(status)));
    }

    let (sender, receiver) = mpsc::channel();
    let block = RcBlock::new(move |next_status: SFSpeechRecognizerAuthorizationStatus| {
        let _ = sender.send(next_status);
    });
    unsafe { SFSpeechRecognizer::requestAuthorization(&block) };
    let next_status = receiver
        .recv_timeout(SPEECH_AUTH_TIMEOUT)
        .map_err(|_| Error::Speech("speech recognition authorization timed out".to_owned()))?;
    if next_status == SFSpeechRecognizerAuthorizationStatus::Authorized {
        Ok(())
    } else {
        Err(Error::Speech(speech_authorization_error(next_status)))
    }
}

/// 使用 macOS 10.14 起可用的采集权限 API，兼容应用支持的 macOS 10.15。
#[cfg(target_os = "macos")]
fn ensure_microphone_authorized() -> Result<()> {
    // AVAudioApplication 仅在 macOS 14+ 可用；AVCaptureDevice 同时覆盖旧系统。
    let media_type = unsafe { AVMediaTypeAudio }
        .ok_or_else(|| Error::Speech("audio capture media type is unavailable".to_owned()))?;
    let permission = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    if !microphone_authorization_requires_prompt(permission)? {
        return Ok(());
    }

    let (sender, receiver) = mpsc::channel();
    let block = RcBlock::new(move |granted: objc2::runtime::Bool| {
        let _ = sender.send(granted.as_bool());
    });
    unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &block) };
    if receiver
        .recv_timeout(MICROPHONE_AUTH_TIMEOUT)
        .map_err(|_| Error::Speech("microphone authorization timed out".to_owned()))?
    {
        Ok(())
    } else {
        Err(Error::Speech("microphone permission was denied".to_owned()))
    }
}

/// 将系统麦克风授权状态转换为是否需要首次询问，拒绝和受限状态不得重复弹窗。
#[cfg(target_os = "macos")]
fn microphone_authorization_requires_prompt(permission: AVAuthorizationStatus) -> Result<bool> {
    if permission == AVAuthorizationStatus::Authorized {
        Ok(false)
    } else if permission == AVAuthorizationStatus::NotDetermined {
        Ok(true)
    } else if permission == AVAuthorizationStatus::Denied {
        Err(Error::Speech("microphone permission was denied".to_owned()))
    } else if permission == AVAuthorizationStatus::Restricted {
        Err(Error::Speech(
            "microphone access is restricted on this device".to_owned(),
        ))
    } else {
        Err(Error::Speech(
            "microphone permission status is unavailable".to_owned(),
        ))
    }
}

/// 在自动释放池内安全复制 Objective-C 字符串内容。
#[cfg(target_os = "macos")]
fn ns_string_to_string(value: &NSString) -> String {
    objc2::rc::autoreleasepool(|pool| unsafe { value.to_str(pool).to_owned() })
}

/// 为已拒绝、受限或未知的语音识别授权生成可读错误。
#[cfg(target_os = "macos")]
fn speech_authorization_error(status: SFSpeechRecognizerAuthorizationStatus) -> String {
    if status == SFSpeechRecognizerAuthorizationStatus::Denied {
        "speech recognition permission was denied".to_owned()
    } else if status == SFSpeechRecognizerAuthorizationStatus::Restricted {
        "speech recognition is restricted on this device".to_owned()
    } else {
        "speech recognition is not authorized".to_owned()
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// 已授权无需弹窗，只有尚未决定的授权允许请求麦克风访问。
    #[test]
    fn microphone_permission_prompts_only_before_first_decision() {
        assert!(
            !microphone_authorization_requires_prompt(AVAuthorizationStatus::Authorized).unwrap()
        );
        assert!(
            microphone_authorization_requires_prompt(AVAuthorizationStatus::NotDetermined).unwrap()
        );
    }

    /// 已拒绝、受限制和未知状态必须在采集开始前返回错误。
    #[test]
    fn microphone_permission_errors_preserve_the_system_reason() {
        for (status, expected) in [
            (AVAuthorizationStatus::Denied, "denied"),
            (AVAuthorizationStatus::Restricted, "restricted"),
            (AVAuthorizationStatus(-1), "unavailable"),
        ] {
            let error = microphone_authorization_requires_prompt(status).unwrap_err();
            assert!(error.to_string().contains(expected));
        }
    }
}
