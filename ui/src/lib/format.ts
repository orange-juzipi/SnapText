import type { Labels } from "@/lib/labels";
import type { DesktopCapabilityStatus, HistoryRecord } from "@/lib/types";

export function singleLineText(value: string) {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

export function formatHistoryForClipboard(items: HistoryRecord[]) {
  return items
    .map((item) => `[${item.source}] ${singleLineText(item.source_text)} -> ${singleLineText(item.translated_text)}`)
    .join("\n");
}

export function formatCapabilitiesForClipboard(items: DesktopCapabilityStatus[]) {
  return items
    .map((item) => `[${item.capability.trim()}] ${item.status.trim()} - ${singleLineText(item.action)}`)
    .join("\n");
}

export function sourceLabel(source: string, labels: Labels) {
  switch (source.trim()) {
    case "":
      return labels.noResult;
    case "text":
      return labels.sourceTextKind;
    case "screenshot":
      return labels.sourceScreenshot;
    case "selection":
      return labels.sourceSelection;
    case "image":
      return labels.sourceImage;
    default:
      return source;
  }
}

export function targetLangLabel(targetLang: string, labels: Labels) {
  const value = targetLang.trim();
  if (!value) return labels.noTarget;
  return languageLabel(value);
}

export function resultMetadataLabel(source: string, targetLang: string, labels: Labels) {
  const sourceValue = sourceLabel(source, labels);
  const targetValue = targetLangLabel(targetLang, labels);
  if (sourceValue === labels.noResult && targetValue === labels.noTarget) return labels.noResult;
  if (targetValue === labels.noTarget) return sourceValue;
  if (sourceValue === labels.noResult) return targetValue;
  return `${sourceValue} -> ${targetValue}`;
}

export function historyItemMeta(item: HistoryRecord, labels: Labels) {
  const source = sourceLabel(item.source, labels);
  return item.target_lang.trim() ? `${source} -> ${languageLabel(item.target_lang)}` : source;
}

export function languageLabel(value: string) {
  switch (value.trim().toLowerCase()) {
    case "en":
      return "英语";
    case "zh_cn":
    case "zh-cn":
    case "zh":
      return "中文";
    case "ja":
      return "日语";
    case "ko":
      return "韩语";
    case "fr":
      return "法语";
    case "de":
      return "德语";
    case "es":
      return "西班牙语";
    case "ru":
      return "俄语";
    default:
      return value.trim();
  }
}

export function translatorProviderLabel(provider?: string) {
  switch (provider?.trim()) {
    case "deepl":
      return "DeepL";
    case "google":
      return "Google";
    case "snaptext_cloud":
    case "openai_compatible":
    case "local_http":
    case undefined:
    case "":
      return "SnapText 免费源";
    default:
      return provider;
  }
}

export function translatorProviderDetailLabel(provider?: string, _endpoint?: string) {
  if (provider?.trim() !== "snaptext_cloud") return translatorProviderLabel(provider);
  return "SnapText 免费源";
}
