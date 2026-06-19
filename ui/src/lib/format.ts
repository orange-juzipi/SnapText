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
  return targetLang.trim() || labels.noTarget;
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
  return item.target_lang.trim() ? `${source} -> ${item.target_lang}` : source;
}
