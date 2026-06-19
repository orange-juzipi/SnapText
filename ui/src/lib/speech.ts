import { synthesizeText } from "@/lib/api";
import type { SpeechConfig } from "@/lib/types";

type SpeakTextInput = {
  text: string;
  lang: string;
  config?: SpeechConfig;
};

let activeAudio: HTMLAudioElement | null = null;

export function isSpeechSupported(config?: SpeechConfig) {
  if (config?.enabled === false) return false;
  if (config?.provider === "coqui") return true;
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export async function speakText({ text, lang, config }: SpeakTextInput) {
  const source = text.trim();
  if (!source) {
    throw new Error("没有可播放的文本");
  }
  if (config?.enabled === false) {
    throw new Error("语音朗读未启用");
  }

  stopSpeech();
  if (config?.provider === "coqui") {
    try {
      await speakWithCoqui(source, lang, config);
      return;
    } catch (error) {
      // Coqui 是可选本地引擎；失败时退回系统朗读，避免 UI 整体不可用。
      if (!canUseSystemSpeech()) throw error;
    }
  }
  speakWithSystem(source, lang, config);
}

export function stopSpeech() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
  if (canUseSystemSpeech()) {
    window.speechSynthesis.cancel();
  }
}

async function speakWithCoqui(text: string, lang: string, config: SpeechConfig) {
  const result = await synthesizeText(text, lang, "coqui");
  const audio = new Audio(pathToAudioUrl(result.audio_path));
  audio.volume = clamp(config.volume, 0, 1);
  activeAudio = audio;
  await audio.play();
}

function speakWithSystem(text: string, lang: string, config?: SpeechConfig) {
  if (!canUseSystemSpeech()) {
    throw new Error("当前环境不支持系统朗读");
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = snapTextLangToSpeechLang(lang);
  utterance.rate = clamp(config?.rate ?? 1, 0.1, 3);
  utterance.volume = clamp(config?.volume ?? 1, 0, 1);
  const voice = bestVoiceForLang(utterance.lang);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function bestVoiceForLang(lang: string) {
  const voices = window.speechSynthesis.getVoices();
  const normalized = lang.toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === normalized) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(normalized.split("-")[0]))
  );
}

function canUseSystemSpeech() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function pathToAudioUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `file://${encodeURI(normalized)}`;
}

export function snapTextLangToSpeechLang(lang: string) {
  const value = lang.trim().toLowerCase();
  return (
    {
      zh_cn: "zh-CN",
      en: "en-US",
      ja: "ja-JP",
      ko: "ko-KR",
      fr: "fr-FR",
      de: "de-DE",
      es: "es-ES",
      ru: "ru-RU",
    }[value] ?? value
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
