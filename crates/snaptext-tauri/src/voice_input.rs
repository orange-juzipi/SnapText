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
use objc2_avf_audio::{
    AVAudioApplication, AVAudioApplicationRecordPermission, AVAudioEngine, AVAudioNode,
    AVAudioPCMBuffer, AVAudioTime,
};
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
    engine: Retained<AVAudioEngine>,
    request: Retained<SFSpeechAudioBufferRecognitionRequest>,
    task: Retained<SFSpeechRecognitionTask>,
    result_handler: RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut objc2_foundation::NSError)>,
    tap_block:
        RcBlock<dyn Fn(core::ptr::NonNull<AVAudioPCMBuffer>, core::ptr::NonNull<AVAudioTime>)>,
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
    latest_text: String,
    latest_final_text: String,
    error: Option<String>,
}

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

#[cfg(not(target_os = "macos"))]
pub(crate) async fn stop_voice_input(_state: &crate::state::AppState) -> Result<String> {
    Err(Error::Speech(
        "voice input is only supported on macOS".to_owned(),
    ))
}

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

#[cfg(target_os = "macos")]
fn ensure_microphone_authorized() -> Result<()> {
    let application = unsafe { AVAudioApplication::sharedInstance() };
    let permission = unsafe { application.recordPermission() };
    if permission == AVAudioApplicationRecordPermission::Granted {
        return Ok(());
    }
    if permission == AVAudioApplicationRecordPermission::Denied {
        return Err(Error::Speech("microphone permission was denied".to_owned()));
    }

    let (sender, receiver) = mpsc::channel();
    let block = RcBlock::new(move |granted: objc2::runtime::Bool| {
        let _ = sender.send(granted.as_bool());
    });
    unsafe { AVAudioApplication::requestRecordPermissionWithCompletionHandler(&block) };
    if receiver
        .recv_timeout(MICROPHONE_AUTH_TIMEOUT)
        .map_err(|_| Error::Speech("microphone authorization timed out".to_owned()))?
    {
        Ok(())
    } else {
        Err(Error::Speech("microphone permission was denied".to_owned()))
    }
}

#[cfg(target_os = "macos")]
fn ns_string_to_string(value: &NSString) -> String {
    objc2::rc::autoreleasepool(|pool| unsafe { value.to_str(pool).to_owned() })
}

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
