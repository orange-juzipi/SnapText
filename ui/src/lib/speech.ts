import { Channel, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SpeechConfig } from "@/lib/types";
import type { LocalSpeechAudio } from "@/lib/types";
import { tauriInvoke } from "@/lib/tauri";
import { getSpeechCapabilities, type SpeechStreamEvent } from "@/lib/cloud-speech";
import { PcmStreamPlayer, decodeAudioFrame } from "@/lib/pcm-player";

/** 所有朗读入口共享的参数。 */
type SpeakTextInput = {
  /** 待朗读文本。 */
  text: string;
  /** 原文或译文语言。 */
  lang: string;
  /** 本地朗读偏好，无厂商密钥。 */
  config?: SpeechConfig;
  /** 英美口音按钮的显式选择。 */
  englishAccent?: string;
  /** 词典提供的真人发音优先于合成。 */
  audioUrl?: string;
  /** 播放结束或主动停止。 */
  onEnd?: () => void;
  /** 播放失败，含已脱敏的提示。 */
  onError?: (message?: string) => void;
  /** 回退等非致命提示。 */
  onNotice?: (message: string) => void;
};
/** 本窗口的会话；跨窗口所有权由 Rust 管理。 */
type Session = {
  /** 唯一的本地播放标识。 */
  id: string;
  /** 当前入口参数。 */
  input: SpeakTextInput;
  /** 当前实际播放方式。 */
  mode: "pending" | "dictionary" | "cloud" | "local" | "system";
  /** 会话是否已经清理。 */
  stopped: boolean;
  /** 流式播放器，在点击手势内初始化。 */
  player?: PcmStreamPlayer;
  /** 当前词典音频。 */
  audio?: HTMLAudioElement;
  /** 自定义 AI 音频解码与播放上下文。 */
  localContext?: AudioContext;
  /** 当前自定义 AI 音频节点。 */
  localSource?: AudioBufferSourceNode;
  /** 已开始播放或已主动取消时解除入口等待。 */
  resolve: () => void;
  /** 开始播放前的失败。 */
  reject: (reason: Error) => void;
};
let active: Session | null = null;
let stopListener: Promise<void> | undefined;

/** 按所选引擎判断环境是否具备播放能力。 */
export function isSpeechSupported(config?: SpeechConfig): boolean {
  if (config?.enabled === false) return false;
  return typeof window !== "undefined" && (canUseSystemSpeech() || canUseAudioPlayback());
}

/** 为已有朗读按钮启动词典、系统或 AI 朗读。 */
export function speakText(input: SpeakTextInput): Promise<void> {
  const text = input.text.trim();
  if (!text && !input.audioUrl) return Promise.reject(new Error("没有可播放的文本"));
  if (input.config?.enabled === false) return Promise.reject(new Error("语音朗读未启用"));
  stopSpeech();
  return new Promise<void>((resolve, reject) => {
    const session: Session = { id: crypto.randomUUID(), input: { ...input, text }, mode: "pending", stopped: false, resolve, reject };
    active = session;
    // 音频权限必须在点击手势内取得，不能等 HTTP 或 IPC 完成后才创建。
    if (input.config?.engine === "snaptext_cloud" && typeof AudioContext !== "undefined") {
      try { session.player = new PcmStreamPlayer(input.config.volume); } catch { /* 后续回退系统朗读。 */ }
    }
    if (input.config?.engine === "local_openai_compatible" && typeof AudioContext !== "undefined") {
      try {
        session.localContext = new AudioContext();
        void session.localContext.resume().catch(() => undefined);
      } catch { /* 本地服务错误会在启动阶段显示。 */ }
    }
    void beginSession(session).catch((error: unknown) => fail(session, error));
  });
}

/** 保留独立词典音频入口；有文本的调用应使用 speakText 的 audioUrl。 */
export function speakAudioUrl(audioUrl: string, onEnd?: () => void, onError?: () => void): Promise<void> {
  return speakText({ text: "", lang: "en", audioUrl, onEnd, onError });
}

/** 立即清理本地音频，异步取消对应原生请求，不影响新会话。 */
export function stopSpeech(): void {
  if (active) finish(active);
  else if (canUseSystemSpeech()) window.speechSynthesis.cancel();
}

/** 跨窗口停止事件只作用于匹配的会话，不携带音频或文本。 */
async function ensureStopListener(): Promise<void> {
  if (!isTauri()) return;
  stopListener ??= listen<{ session_id: string }>("snaptext://speech-stopped", (event) => {
    if (active?.id === event.payload.session_id) finish(active);
  }).then(() => {
    window.addEventListener("beforeunload", stopSpeech);
  }).catch((error: unknown) => {
    // 窗口启动时 IPC 可能暂时不可用，下一次点击应能重新注册而非永久复用拒绝结果。
    stopListener = undefined;
    throw error;
  });
  await stopListener;
}

/** 注册全局播放权后优先播放词典音频。 */
async function beginSession(session: Session): Promise<void> {
  await ensureStopListener();
  if (!isCurrent(session)) return;
  if (isTauri()) await tauriInvoke("claim_speech", { sessionId: session.id });
  if (!isCurrent(session)) {
    if (isTauri()) void tauriInvoke("cancel_speech", { sessionId: session.id }).catch(() => undefined);
    return;
  }
  if (session.input.audioUrl && canUseAudioPlayback()) {
    session.mode = "dictionary";
    const audio = new Audio(session.input.audioUrl);
    audio.volume = clamp(session.input.config?.volume ?? 1, 0, 1);
    session.audio = audio;
    audio.onended = () => finish(session);
    /** 词典下载或解码失败也进入所选引擎，不能仅处理 play() 的拒绝。 */
    const fallback = () => {
      if (!isCurrent(session) || session.mode !== "dictionary") return;
      audio.onended = null; audio.onerror = null; audio.pause(); session.audio = undefined;
      void startEngine(session).catch((error: unknown) => fail(session, error));
    };
    audio.onerror = fallback;
    void audio.play().then(() => { if (isCurrent(session)) session.resolve(); }).catch(fallback);
    return;
  }
  await startEngine(session);
}

/** 根据选择开启云端或系统合成，云端服务与翻译开关独立。 */
async function startEngine(session: Session): Promise<void> {
  if (!isCurrent(session)) return;
  if (!session.input.text) throw new Error("词典音频不可用");
  if (session.input.config?.engine === "local_openai_compatible") {
    await startLocalSpeech(session);
    return;
  }
  if (session.input.config?.engine !== "snaptext_cloud") { startSystem(session); return; }
  session.mode = "cloud";
  try {
    const language = normalizedCloudLanguage(session.input.lang);
    if (!language) throw new Error("此语言暂不支持 AI 朗读");
    if (!session.player || !isTauri()) throw new Error("当前环境不支持 AI 音频播放");
    const capabilities = await getSpeechCapabilities();
    if (!isCurrent(session) || session.mode !== "cloud") return;
    if (!capabilities.enabled) throw new Error("云端 AI 朗读暂未启用");
    if (!capabilities.languages.includes(language)) throw new Error("此语言暂不支持 AI 朗读");
    if ([...session.input.text].length > capabilities.max_chars_per_request) throw new Error("文本超过 AI 朗读单次字符限制");
    const selected = session.input.config.cloud_voice_by_lang?.[language];
    const voice = capabilities.voices.some((item) => item.id === selected && item.language === language) ? selected : capabilities.default_voices[language];
    const channel = new Channel<{ session_id: string; event: SpeechStreamEvent }>();
    let queue = Promise.resolve();
    let cloudId = "";
    let sequence = 0;
    let terminal = false;
    /** 单帧消费并确认后 Rust 才继续读取下一帧，保证 IPC 有界。 */
    const consume = async (message: { session_id: string; event: SpeechStreamEvent }) => {
      if (!isCurrent(session) || session.mode !== "cloud" || message.session_id !== session.id) return;
      const event = message.event;
      if (terminal) throw new Error("语音结束后收到额外音频");
      if (event.type === "meta") {
        if (cloudId || event.format !== "pcm16le" || event.sample_rate !== 24000 || event.channels !== 1) throw new Error("语音格式不受支持");
        cloudId = event.request_id;
      }
      if (!cloudId || event.request_id !== cloudId) throw new Error("语音会话不匹配");
      if (event.type === "audio") {
        if (event.sequence !== sequence++ || typeof event.data !== "string") throw new Error("语音分片顺序错误");
        await session.player!.enqueue(decodeAudioFrame(event.data));
        if (!isCurrent(session) || session.mode !== "cloud") return;
        session.resolve();
        await tauriInvoke("acknowledge_speech", { sessionId: session.id, sequence: event.sequence });
      } else if (event.type === "error") {
        terminal = true;
        throw new Error(event.message || "云端语音流中断，请重试");
      } else if (event.type === "done") {
        terminal = true;
        await session.player!.finish();
        if (isCurrent(session)) finish(session);
      }
    };
    channel.onmessage = (message) => {
      queue = queue.then(() => consume(message)).catch((error: unknown) => cloudFailed(session, error));
    };
    void tauriInvoke("start_cloud_speech", {
      sessionId: session.id,
      request: { text: session.input.text, language, voice: voice ?? null, rate: session.input.config.rate, english_accent: session.input.englishAccent ?? session.input.config.english_accent },
      channel,
    }).then(async () => {
      await queue;
      if (isCurrent(session) && session.mode === "cloud" && !terminal) cloudFailed(session, new Error("语音流提前中断，请重试"));
    }).catch((error: unknown) => cloudFailed(session, error));
  } catch (error) { cloudFailed(session, error); }
}

/** 请求用户本机 TTS endpoint，并以 Web Audio 播放 WAV/MP3。 */
async function startLocalSpeech(session: Session): Promise<void> {
  session.mode = "local";
  try {
    if (!isTauri() || !session.localContext) throw new Error("当前环境不支持自定义 AI 音频播放");
    const local = session.input.config!.local_ai;
    if (!local.endpoint.trim()) throw new Error("请先配置自定义 AI 语音地址");
    if (!local.model.trim()) throw new Error("请先配置自定义 AI 语音模型");
    if (!local.voice.trim()) throw new Error("请先配置自定义 AI 语音音色");
    const audio = await tauriInvoke<LocalSpeechAudio>("start_local_speech", {
      sessionId: session.id,
      request: {
        text: session.input.text,
        endpoint: local.endpoint,
        apiKey: local.api_key,
        model: local.model,
        voice: local.voice,
        rate: session.input.config!.rate,
        responseFormat: local.response_format,
      },
    });
    if (!isCurrent(session) || session.mode !== "local") return;
    const context = session.localContext;
    await context.resume();
    if (!isCurrent(session) || session.mode !== "local") return;
    const bytes = Uint8Array.from(atob(audio.audio_base64), (value) => value.charCodeAt(0));
    const decoded = await context.decodeAudioData(bytes.buffer);
    if (!isCurrent(session) || session.mode !== "local") return;
    const gain = context.createGain();
    gain.gain.value = clamp(session.input.config!.volume, 0, 1);
    gain.connect(context.destination);
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(gain);
    session.localSource = source;
    source.onended = () => {
      session.localSource = undefined;
      gain.disconnect();
      finish(session);
    };
    source.start();
    session.resolve();
  } catch (error) {
    if (isCurrent(session)) fail(session, error);
  }
}

/** 首段尚未播出时提示并回退；已播出后失败不会从头重读。 */
function cloudFailed(session: Session, error: unknown): void {
  if (!isCurrent(session) || session.mode !== "cloud") return;
  const message = error instanceof Error ? error.message : "云端语音暂不可用";
  if (session.player?.hasStarted) { fail(session, new Error(message)); return; }
  session.mode = "system";
  session.player?.cancel(); session.player = undefined;
  // 只中止网络流，保留播放权，避免停止事件误杀接下来的系统朗读。
  if (isTauri()) void tauriInvoke("cancel_speech", { sessionId: session.id, streamOnly: true }).catch(() => undefined);
  session.input.onNotice?.(message + "，已改用系统朗读。");
  try { startSystem(session); } catch (nextError) { fail(session, nextError); }
}

/** 按原有语言、口音及语速规则调用设备朗读。 */
function startSystem(session: Session): void {
  if (!isCurrent(session)) return;
  if (!canUseSystemSpeech()) throw new Error("当前环境不支持系统朗读");
  session.mode = "system";
  session.player?.cancel(); session.player = undefined;
  const input = session.input;
  const utterance = new SpeechSynthesisUtterance(input.text);
  utterance.lang = snapTextLangToSpeechLang(input.lang, input.englishAccent ?? input.config?.english_accent);
  utterance.rate = clamp(input.config?.rate ?? 1, 0.1, 3);
  utterance.volume = clamp(input.config?.volume ?? 1, 0, 1);
  const voice = bestVoiceForLang(utterance.lang);
  if (voice) utterance.voice = voice;
  utterance.onend = () => finish(session);
  utterance.onerror = () => fail(session, new Error("系统朗读失败"));
  window.speechSynthesis.speak(utterance);
  session.resolve();
}

/** 失败提示与开始阶段的 Promise 拒绝保持一致。 */
function fail(session: Session, error: unknown): void {
  finish(session, error instanceof Error ? error : new Error(String(error)));
}

/** 完成、故障和主动停止统一清理，回调最多执行一次。 */
function finish(session: Session, error?: Error): void {
  if (!isCurrent(session)) return;
  session.stopped = true; active = null;
  session.player?.cancel();
  if (session.localSource) {
    session.localSource.onended = null;
    try { session.localSource.stop(); } catch { /* 播放节点可能已经结束。 */ }
    session.localSource.disconnect();
    session.localSource = undefined;
  }
  if (session.localContext && session.localContext.state !== "closed") {
    void session.localContext.close().catch(() => undefined);
    session.localContext = undefined;
  }
  if (session.audio) { session.audio.onended = null; session.audio.onerror = null; session.audio.pause(); }
  if (canUseSystemSpeech()) window.speechSynthesis.cancel();
  if (isTauri()) void tauriInvoke("cancel_speech", { sessionId: session.id }).catch(() => undefined);
  if (error) { session.reject(error); session.input.onError?.(error.message); }
  else { session.resolve(); session.input.onEnd?.(); }
}

/** 判断异步回调是否仍属于当前播放。 */
function isCurrent(session: Session): boolean { return active === session && !session.stopped; }
/** 云端首期仅提供中文和英文，其他语言保留系统能力。 */
function normalizedCloudLanguage(lang: string): string | null {
  const value = lang.toLowerCase().replaceAll("-", "_");
  if (["zh", "zh_cn", "zh_hans"].includes(value)) return "zh_cn";
  if (["en", "en_us", "en_gb"].includes(value)) return "en";
  return null;
}
/** 优先选择匹配地区的系统音色，然后匹配语言。 */
function bestVoiceForLang(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const normalized = lang.toLowerCase();
  return voices.find((voice) => voice.lang.toLowerCase() === normalized) ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(normalized.split("-")[0]));
}
/** 检查系统朗读 API。 */
function canUseSystemSpeech(): boolean { return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window; }
/** 检查词典音频播放能力。 */
function canUseAudioPlayback(): boolean { return typeof window !== "undefined" && "Audio" in window; }
/** 将应用语言映射到系统朗读语言代码。 */
export function snapTextLangToSpeechLang(lang: string, englishAccent = "american"): string {
  const value = lang.trim().toLowerCase();
  if (value === "en") return englishAccent === "british" ? "en-GB" : "en-US";
  return ({ zh_cn: "zh-CN", ja: "ja-JP", ko: "ko-KR", fr: "fr-FR", de: "de-DE", es: "es-ES", ru: "ru-RU" }[value] ?? value);
}
/** 限制本地播放参数在现有可接受范围内。 */
function clamp(value: number, min: number, max: number): number { return Math.min(Math.max(value, min), max); }
