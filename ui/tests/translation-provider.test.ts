import { expect, test } from "bun:test";
import { labelsForLanguage } from "../src/lib/labels";
import { translatorProviderLabel } from "../src/lib/format";
import { mergeProviderConfig, providerRequiresApiKey, sanitizeProviderConfig, visibleProvider } from "../src/lib/translation-provider";
import type { AppConfig } from "../src/lib/types";

/** 构造服务草稿与独立界面设置，避免测试依赖真实云端或用户配置。 */
function configuration(): AppConfig {
  return {
    ui: { language: "zh_cn", theme: "light" },
    translator: {
      provider: "google_web",
      snaptext_cloud: { endpoint: "https://example.com", device_id: " test-device ", enabled: true, privacy_sensitive: true },
      deepl: { base_url: " https://api-free.deepl.com ", api_key: " deepl-key " },
      google: { base_url: " https://translation.googleapis.com ", api_key: null },
    },
  } as AppConfig;
}

/** 网页直连保存时无需密钥，同时禁用云端翻译并保留其他服务的凭据。 */
test("saves Google Web without credentials and preserves the direct provider", () => {
  const draft = configuration();
  const saved = sanitizeProviderConfig(draft);
  expect(saved.translator.provider).toBe("google_web");
  expect(saved.translator.snaptext_cloud.enabled).toBe(false);
  expect(saved.translator.google.api_key).toBeNull();
  expect(saved.translator.deepl.api_key).toBe("deepl-key");
  expect(providerRequiresApiKey("google_web")).toBe(false);
  expect(providerRequiresApiKey("google")).toBe(true);
  expect(providerRequiresApiKey("deepl")).toBe(true);
  expect(draft.translator.snaptext_cloud.enabled).toBe(true);
});

/** 后台界面保存与服务切换并行时，服务草稿不能覆盖最新的界面设置。 */
test("merges a direct-provider draft without reverting unrelated settings", () => {
  const current = configuration();
  current.ui.theme = "dark";
  current.translator.provider = "snaptext_cloud";
  const draft = configuration();
  const saved = sanitizeProviderConfig(mergeProviderConfig(current, draft));
  expect(saved.ui.theme).toBe("dark");
  expect(saved.translator.provider).toBe("google_web");
  expect(saved.translator.snaptext_cloud.privacy_sensitive).toBe(true);
  expect(current.translator.provider).toBe("snaptext_cloud");
});

/** 旧配置和别名规范化后，两处入口始终识别同一服务且名称可区分。 */
test("normalizes Google Web aliases and distinguishes both Google choices in both languages", () => {
  expect(visibleProvider(" google-web ")).toBe("google_web");
  expect(visibleProvider("google_web")).toBe("google_web");
  expect(visibleProvider("openai_compatible")).toBe("snaptext_cloud");
  expect(visibleProvider("unknown")).toBe("snaptext_cloud");
  for (const language of ["zh_cn", "en"]) {
    const labels = labelsForLanguage(language);
    expect(translatorProviderLabel("google_web", labels)).toBe(labels.googleWebProvider);
    expect(translatorProviderLabel("google-web", labels)).toBe(labels.googleWebProvider);
    expect(translatorProviderLabel("google", labels)).toBe(labels.googleApiProvider);
    expect(labels.googleWebProvider).not.toBe(labels.googleApiProvider);
  }
});
