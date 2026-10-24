import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceStateProvider, useWorkspaceState } from "../src/app/workspace-state";

/** 取得真实 Provider 的同步请求所有权 API，无需伪造 React hook。 */
function createWorkspace() {
  let workspace: ReturnType<typeof useWorkspaceState> | undefined;
  /** 在 Provider 内捕获上下文，用于校验不依赖 DOM 的请求代次。 */
  function Probe() {
    workspace = useWorkspaceState();
    return null;
  }
  renderToStaticMarkup(createElement(WorkspaceStateProvider, { children: createElement(Probe) }));
  return workspace!;
}

/** 手动翻译和原生划词请求必须共享所有权，旧请求完成不能废弃新请求。 */
test("only the latest translation owns the workspace", () => {
  const workspace = createWorkspace();
  const manual = workspace.beginTranslation();
  const native = workspace.beginTranslation();
  expect(workspace.isTranslationCurrent(manual)).toBe(false);
  workspace.finishTranslation(manual);
  expect(workspace.isTranslationCurrent(native)).toBe(true);
  workspace.cancelTranslation();
  expect(workspace.isTranslationCurrent(native)).toBe(false);
});

/** 输入、语言、OCR、历史和清空操作都必须同步阻止旧响应写回。 */
test("content changes invalidate requests before the next render", () => {
  const workspace = createWorkspace();
  const result = { source: "text", source_text: "current", translated_text: "当前", target_lang: "zh_cn" };
  const mutations = [
    () => workspace.setTextInput("new input"),
    () => workspace.setSourceLang("ja"),
    () => workspace.setTargetLang("en"),
    () => workspace.setOcrTextInput("recognized", "screenshot"),
    () => workspace.setResultSnapshot(result),
    () => workspace.setTranslationResultOnly(result),
    () => workspace.swapTextPanels({ sourceText: "当前", translatedText: "current", targetLang: "en" }),
    () => workspace.clearTranslation(),
    () => workspace.clearTextPanels(),
    () => workspace.clearResult(),
  ];
  for (const mutate of mutations) {
    const pending = workspace.beginTranslation();
    mutate();
    expect(workspace.isTranslationCurrent(pending)).toBe(false);
  }
});

/** 重选当前选项或重复提交同样输入时，没有新渲染可重启请求，因此应保留当前所有权。 */
test("unchanged input and language selections preserve the pending request", () => {
  const workspace = createWorkspace();
  const initial = workspace.beginTranslation();
  workspace.setTextInput("");
  workspace.setSourceLang("auto");
  workspace.setTargetLang("auto");
  expect(workspace.isTranslationCurrent(initial)).toBe(true);

  workspace.setOcrTextInput("recognized", "screenshot");
  workspace.setSourceLang("ja");
  workspace.setTargetLang("zh_cn");
  const changed = workspace.beginTranslation();
  workspace.setTextInput("recognized");
  workspace.setSourceLang("ja");
  workspace.setTargetLang("zh-CN");
  expect(workspace.isTranslationCurrent(changed)).toBe(true);

  workspace.setTextInput("edited");
  expect(workspace.isTranslationCurrent(changed)).toBe(false);
  const edited = workspace.beginTranslation();
  workspace.setTextInput("edited");
  expect(workspace.isTranslationCurrent(edited)).toBe(true);
});
