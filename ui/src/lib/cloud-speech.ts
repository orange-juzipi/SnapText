import { tauriInvoke } from "@/lib/tauri";

/** 由 cloud 返回的音色目录项。 */
export type SpeechVoice = {
  /** 供应商音色标识。 */
  id: string;
  /** 可展示名称。 */
  name: string;
  /** 适用语言。 */
  language: string;
};
/** 不包含厂商密钥的能力配置。 */
export type SpeechCapabilities = {
  /** 服务是否启用且凭据可用。 */
  enabled: boolean;
  /** 供应商展示标识。 */
  provider: string;
  /** 服务支持的规范语言代码。 */
  languages: string[];
  /** 所有可选音色。 */
  voices: SpeechVoice[];
  /** 默认语言音色映射。 */
  default_voices: Record<string, string>;
  /** 单次最多 Unicode 字符数。 */
  max_chars_per_request: number;
};
/** 独立语音额度，不与翻译共享计数。 */
export type SpeechQuota = {
  /** 当日总字符数。 */
  free_chars_today: number;
  /** 当日已计入的尝试字符数。 */
  used_chars_today: number;
  /** 当日剩余字符数。 */
  remaining_chars_today: number;
  /** UTC 重置时间。 */
  reset_at: string;
};
/** 原生层验证后的流事件。 */
export type SpeechStreamEvent = {
  /** 协议事件种类。 */
  type: "meta" | "audio" | "done" | "error";
  /** cloud 请求标识。 */
  request_id: string;
  /** 从零开始的音频帧序号。 */
  sequence?: number;
  /** Base64 PCM16LE 数据。 */
  data?: string;
  /** meta 中的固定音频格式。 */
  format?: string;
  /** meta 中的采样率。 */
  sample_rate?: number;
  /** meta 中的声道数。 */
  channels?: number;
  /** meta/done 中的语音配额。 */
  quota?: SpeechQuota;
  /** 流错误的稳定代码。 */
  code?: string;
  /** 已脱敏的错误说明。 */
  message?: string;
};
/** 获取可选音色，不发送朗读文本。 */
export function getSpeechCapabilities(): Promise<SpeechCapabilities> {
  return tauriInvoke("get_speech_capabilities");
}
/** 获取当前设备的语音剩余额度。 */
export function getSpeechQuota(): Promise<SpeechQuota> {
  return tauriInvoke("get_speech_quota");
}
