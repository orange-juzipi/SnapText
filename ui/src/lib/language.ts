export const AUTO_TARGET_LANG = "auto";

export function resolveTargetLang(sourceText: string, targetLang: string) {
  const value = targetLang.trim();
  if (value && value !== AUTO_TARGET_LANG) {
    return value;
  }

  // Auto target optimizes the common Chinese-English reading workflow.
  return looksLikeChinese(sourceText) ? "en" : "zh_cn";
}

export function resolveSourceSpeechLang(sourceText: string) {
  return looksLikeChinese(sourceText) ? "zh_cn" : "en";
}

export function looksLikeChinese(text: string) {
  const sample = text.trim();
  if (!sample) return false;

  const chars = [...sample];
  const chineseCount = chars.filter((char) => /[\u3400-\u9fff]/u.test(char)).length;
  const latinCount = chars.filter((char) => /[A-Za-z]/u.test(char)).length;

  return chineseCount > 0 && chineseCount >= latinCount * 0.35;
}
