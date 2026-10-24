import { expect, test } from "bun:test";
import { detectSourceLang, resolveSourceLang, resolveTargetLang } from "../src/lib/language";

/** 日语和韩语中的汉字不能抢先将整段文本识别为中文。 */
test("detects mixed Japanese and Korean scripts before shared Han characters", () => {
  expect(detectSourceLang("日本語です")).toBe("ja");
  expect(detectSourceLang("韓國 한국어")).toBe("ko");
  expect(detectSourceLang("中文测试")).toBe("zh_cn");
  expect(resolveTargetLang("日本語です", "auto")).toBe("zh_cn");
});

/** 用户的语言选择可修正短句、专名和混合语言的启发式误判。 */
test("preserves an explicit source language and only detects in automatic mode", () => {
  expect(resolveSourceLang("日本語", "ja")).toBe("ja");
  expect(resolveSourceLang("中文引用", "en")).toBe("en");
  expect(resolveSourceLang("日本語です", "auto")).toBe("ja");
  expect(resolveSourceLang("123", "auto")).toBeUndefined();
});
