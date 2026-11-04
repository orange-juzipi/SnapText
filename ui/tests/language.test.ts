import { expect, test } from "bun:test";
import { detectSourceLang, resolveSourceLang, resolveSourceSpeechLang, resolveTargetLang } from "../src/lib/language";

/** 日语和韩语中的汉字不能抢先将整段文本识别为中文。 */
test("detects mixed Japanese and Korean scripts before shared Han characters", () => {
  expect(detectSourceLang("日本語です")).toBe("ja");
  expect(detectSourceLang("韓國 한국어")).toBe("ko");
  expect(detectSourceLang("中文测试")).toBe("zh_cn");
  expect(resolveTargetLang("日本語です", "auto")).toBe("zh_cn");
});

/** 用户明确选择语言时发送规范化后的值，自动模式不发送启发式猜测。 */
test("preserves explicit source languages and leaves automatic detection to the provider", () => {
  expect(resolveSourceLang("日本語", "ja")).toBe("ja");
  expect(resolveSourceLang("中文引用", "en")).toBe("en");
  expect(resolveSourceLang("中文引用", "zh-CN")).toBe("zh_cn");
  for (const text of ["Bonjour", "Hola", "Guten Morgen", "Привіт", "日本語です", "中文测试", "123"]) {
    expect(resolveSourceLang(text, "auto")).toBeUndefined();
    expect(resolveSourceLang(text, "")).toBeUndefined();
  }
});

/** 没有命中或多个语言并列时，界面不把拉丁短词错误标为英语或其他语言。 */
test("keeps uncertain Latin text in the undetected state", () => {
  for (const text of ["Bonjour", "Hola", "Guten Morgen", "SnapText", "la", "123"]) {
    expect(detectSourceLang(text)).toBe("auto");
  }
  expect(detectSourceLang("this is the book")).toBe("en");
});

/** 翻译请求的自动检测策略不影响本机朗读的文字提示和明确音色选择。 */
test("retains local language hints for speech without constraining translation", () => {
  expect(resolveSourceSpeechLang("中文测试", "auto")).toBe("zh_cn");
  expect(resolveSourceSpeechLang("日本語です", "auto")).toBe("ja");
  expect(resolveSourceSpeechLang("韓國 한국어", "auto")).toBe("ko");
  expect(resolveSourceSpeechLang("this is the book", "auto")).toBe("en");
  expect(resolveSourceSpeechLang("Bonjour", "fr")).toBe("fr");
  expect(resolveSourceSpeechLang("Bonjour", "auto")).toBe("en");
});
