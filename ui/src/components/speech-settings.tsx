import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getSpeechCapabilities, getSpeechQuota } from "@/lib/cloud-speech";
import { speakText, stopSpeech } from "@/lib/speech";
import type { SpeechConfig } from "@/lib/types";

/** 在既有语音设置内增加来源、音色、额度和流式试听。 */
export function SpeechSettingsFields({ config, onChange }: {
  /** 当前未保存或已保存的朗读偏好。 */
  config: SpeechConfig;
  /** 交给设置页统一防抖保存，不增加单独的配置文件。 */
  onChange: (change: Partial<SpeechConfig>) => void;
}) {
  const cloud = config.engine === "snaptext_cloud";
  const local = config.engine === "local_openai_compatible";
  const capabilities = useQuery({ queryKey: ["speech-capabilities"], queryFn: getSpeechCapabilities, enabled: cloud && config.enabled, retry: false, staleTime: 30_000, refetchInterval: 30_000 });
  const quota = useQuery({ queryKey: ["speech-quota"], queryFn: getSpeechQuota, enabled: cloud && config.enabled, retry: false, refetchInterval: 30_000 });
  const cloudStatus = !config.enabled
    ? "off"
    : capabilities.isPending
      ? "checking"
      : capabilities.isError || !capabilities.data?.enabled
        ? "unavailable"
        : "available";
  const cloudStatusLabel = {
    off: "朗读已关闭",
    checking: "正在检查云端朗读服务",
    unavailable: "云端朗读服务不可用",
    available: "云端朗读服务可用",
  }[cloudStatus];
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState("");

  /** 离开设置时不遗留试听或网络请求。 */
  useEffect(() => () => stopSpeech(), []);

  /** 在点击手势内启动当前草稿音色，并显示回退及错误。 */
  async function previewVoice(language: string) {
    stopSpeech();
    setPreview(true);
    setStatus("正在准备朗读…");
    try {
      await speakText({
        text: language === "en" ? "Welcome to SnapText. Listen as your text comes to life." : "欢迎使用 SnapText，现在可以边生成边聆听文字。",
        lang: language, config,
        onEnd: () => {
          setPreview(false);
          setStatus((current) => current === "正在准备朗读…" || current === "正在朗读…" ? "试听已结束" : current);
          if (cloud) void quota.refetch();
        },
        onError: (message) => { setPreview(false); setStatus(message ?? "试听失败"); },
        onNotice: setStatus,
      });
      setStatus((current) => current === "正在准备朗读…" ? "正在朗读…" : current);
    } catch (error) { setPreview(false); setStatus(error instanceof Error ? error.message : "试听失败"); }
  }

  return <>
    <Field>
      <FieldLabel id="speech-engine-label">朗读来源</FieldLabel>
      <Select aria-labelledby="speech-engine-label" id="speech-engine" disabled={!config.enabled} value={config.engine ?? "system"} onChange={(event) => { stopSpeech(); onChange({ engine: event.target.value as SpeechConfig["engine"] }); }}>
        <option value="system">系统朗读</option>
        <option value="snaptext_cloud">AI 朗读 · 官方源</option>
        <option value="local_openai_compatible">自定义 AI 朗读 · OpenAI-compatible</option>
      </Select>
      <FieldHint>{cloud ? "朗读文本将发送至 SnapText Cloud。无需在本机填写密钥。" : local ? "使用你配置的 OpenAI-compatible endpoint 合成语音。" : "使用设备提供的系统音色。"}</FieldHint>
    </Field>
    {cloud && <>
      <Field>
        <FieldLabel className="settings-cloud-status-label">云端状态
          <span className="settings-cloud-status-light" data-status={cloudStatus} role="img" aria-label={cloudStatusLabel} title={cloudStatusLabel} />
        </FieldLabel>
        <FieldHint>{!config.enabled ? "启用朗读后查询云端状态与配额。" : quota.data ? "今日语音剩余 " + quota.data.remaining_chars_today.toLocaleString() + " / " + quota.data.free_chars_today.toLocaleString() + " 字符" : quota.isError ? "暂时无法获取语音配额" : "正在获取独立语音配额…"}</FieldHint>
      </Field>
      {[{ code: "zh_cn", label: "中文音色" }, { code: "en", label: "英文音色" }].map((language) => <Field key={language.code}>
        <FieldLabel id={"speech-voice-label-" + language.code}>{language.label}</FieldLabel>
        <Select aria-labelledby={"speech-voice-label-" + language.code} id={"speech-voice-" + language.code} disabled={!config.enabled || !capabilities.data} value={config.cloud_voice_by_lang?.[language.code] ?? ""} onChange={(event) => { stopSpeech(); onChange({ cloud_voice_by_lang: { ...config.cloud_voice_by_lang, [language.code]: event.target.value } }); }}>
          {!capabilities.data && <option value={config.cloud_voice_by_lang?.[language.code] ?? ""}>{config.cloud_voice_by_lang?.[language.code] ?? "等待音色目录"}</option>}
          {capabilities.data?.voices.filter((voice) => voice.language === language.code).map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
        </Select>
      </Field>)}
      <FieldHint>AI 语速和英美口音属于合成参考，实际效果可能略有差异。其他语言会使用系统朗读；已开始的 AI 音频中断时不会自动重读。</FieldHint>
    </>}
    {local && <>
      <Field>
        <FieldLabel id="speech-local-endpoint-label">语音接口地址</FieldLabel>
        <Input aria-labelledby="speech-local-endpoint-label" autoComplete="url" disabled={!config.enabled} placeholder="http://127.0.0.1:8000/v1/audio/speech" value={config.local_ai.endpoint} onChange={(event) => onChange({ local_ai: { ...config.local_ai, endpoint: event.target.value } })} />
        <FieldHint>填写 OpenAI-compatible 的完整音频生成 endpoint。</FieldHint>
      </Field>
      <Field>
        <FieldLabel id="speech-local-api-key-label">API Key</FieldLabel>
        <Input aria-labelledby="speech-local-api-key-label" autoComplete="new-password" disabled={!config.enabled} type="password" value={config.local_ai.api_key ?? ""} onChange={(event) => onChange({ local_ai: { ...config.local_ai, api_key: event.target.value || null } })} />
        <FieldHint>可留空；密钥保存在应用配置中，并发送到上面的地址。</FieldHint>
      </Field>
      <Field>
        <FieldLabel id="speech-local-model-label">模型</FieldLabel>
        <Input aria-labelledby="speech-local-model-label" autoComplete="off" disabled={!config.enabled} placeholder="tts-1" value={config.local_ai.model} onChange={(event) => onChange({ local_ai: { ...config.local_ai, model: event.target.value } })} />
      </Field>
      <Field>
        <FieldLabel id="speech-local-voice-label">音色</FieldLabel>
        <Input aria-labelledby="speech-local-voice-label" autoComplete="off" disabled={!config.enabled} placeholder="alloy" value={config.local_ai.voice} onChange={(event) => onChange({ local_ai: { ...config.local_ai, voice: event.target.value } })} />
      </Field>
      <Field>
        <FieldLabel id="speech-local-format-label">音频格式</FieldLabel>
        <Select aria-labelledby="speech-local-format-label" disabled={!config.enabled} value={config.local_ai.response_format} onChange={(event) => onChange({ local_ai: { ...config.local_ai, response_format: event.target.value as "wav" | "mp3" } })}>
          <option value="wav">WAV</option>
          <option value="mp3">MP3</option>
        </Select>
      </Field>
    </>}
    <Field>
      <FieldLabel>试听</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={!config.enabled} onClick={() => void previewVoice("zh_cn")}>中文试听</Button>
        <Button type="button" variant="secondary" disabled={!config.enabled} onClick={() => void previewVoice("en")}>英文试听</Button>
        {preview && <Button type="button" variant="secondary" onClick={stopSpeech}>停止</Button>}
      </div>
      <FieldHint role="status">{status}</FieldHint>
    </Field>
  </>;
}
