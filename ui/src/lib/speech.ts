import type { SpeechConfig } from "@/lib/types";

type SpeakTextInput = {
  text: string;
  lang: string;
  config?: SpeechConfig;
  englishAccent?: string;
  onEnd?: () => void;
  onError?: () => void;
};

export function isSpeechSupported(config?: SpeechConfig) {
  if (config?.enabled === false) return false;
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export async function speakText({ text, lang, config, englishAccent, onEnd, onError }: SpeakTextInput) {
  const source = text.trim();
  if (!source) {
    throw new Error("没有可播放的文本");
  }
  if (config?.enabled === false) {
    throw new Error("语音朗读未启用");
  }

  stopSpeech();
  speakWithSystem(source, lang, config, englishAccent, onEnd, onError);
}

export function stopSpeech() {
  if (canUseSystemSpeech()) {
    window.speechSynthesis.cancel();
  }
}

function speakWithSystem(
  text: string,
  lang: string,
  config?: SpeechConfig,
  englishAccent?: string,
  onEnd?: () => void,
  onError?: () => void,
) {
  if (!canUseSystemSpeech()) {
    throw new Error("当前环境不支持系统朗读");
  }
  const utterance = new SpeechSynthesisUtterance(text);
  // English has separate US/UK voice choices; other languages keep the app language mapping.
  utterance.lang = snapTextLangToSpeechLang(lang, englishAccent ?? config?.english_accent);
  utterance.rate = clamp(config?.rate ?? 1, 0.1, 3);
  utterance.volume = clamp(config?.volume ?? 1, 0, 1);
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onError?.();
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

export function snapTextLangToSpeechLang(lang: string, englishAccent = "american") {
  const value = lang.trim().toLowerCase();
  if (value === "en") {
    return englishAccent === "british" ? "en-GB" : "en-US";
  }
  return (
    {
      zh_cn: "zh-CN",
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
