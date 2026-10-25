import { clientSnapTextCloudEndpoint } from "@/lib/snaptext-cloud";
import type { AppConfig } from "@/lib/types";

/** 客户端可选择的翻译服务；网页直连与 Google 官方 API 独立保存。 */
export type ProviderId = "snaptext_cloud" | "deepl" | "google" | "google_web";

/** 两处设置入口共用同一组服务，保持默认官方源与现有 API 的顺序。 */
export const PROVIDER_IDS: readonly ProviderId[] = ["snaptext_cloud", "deepl", "google", "google_web"];

/** 保留支持的服务标识，旧版或未知配置仍展示默认官方源。 */
export function visibleProvider(provider?: string): ProviderId {
  const normalized = provider?.trim() === "google-web" ? "google_web" : provider?.trim();
  return PROVIDER_IDS.includes(normalized as ProviderId) ? normalized as ProviderId : "snaptext_cloud";
}

/** 网页直连与官方源无需密钥，只有收费 API 服务检查密钥。 */
export function providerRequiresApiKey(provider: ProviderId): boolean {
  return provider === "deepl" || provider === "google";
}

/** 合并服务草稿时保留最新的界面、快捷键、语音等独立设置。 */
export function mergeProviderConfig(current: AppConfig, providerDraft: AppConfig): AppConfig {
  const next = structuredClone(current);
  next.translator.provider = providerDraft.translator.provider;
  next.translator.snaptext_cloud = structuredClone(providerDraft.translator.snaptext_cloud);
  next.translator.deepl = structuredClone(providerDraft.translator.deepl);
  next.translator.google = structuredClone(providerDraft.translator.google);
  return next;
}

/** 清理服务草稿，不为免密钥网页直连新增地址或密钥配置。 */
export function sanitizeProviderConfig(config: AppConfig): AppConfig {
  const next = structuredClone(config);
  next.translator.provider = visibleProvider(next.translator.provider.trim());
  next.translator.snaptext_cloud.endpoint = clientSnapTextCloudEndpoint();
  // 只有显式选择官方源才启用云端，直连失败由原生层直接返回错误。
  next.translator.snaptext_cloud.enabled = next.translator.provider === "snaptext_cloud";
  next.translator.snaptext_cloud.device_id = next.translator.snaptext_cloud.device_id.trim();
  next.translator.deepl.base_url = next.translator.deepl.base_url.trim();
  next.translator.deepl.api_key = optionalTrim(next.translator.deepl.api_key);
  next.translator.google.base_url = next.translator.google.base_url.trim();
  next.translator.google.api_key = optionalTrim(next.translator.google.api_key);
  return next;
}

/** 移除密钥首尾空白，并将未填写的可选值规范化为空值。 */
function optionalTrim(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}
