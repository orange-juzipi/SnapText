import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceStateProvider, useWorkspaceState } from "../src/app/workspace-state";
import { isCurrentOcrSession } from "../src/lib/ocr-session";

/** 通过真实工作区取得同步代次 API，以覆盖 OCR 和新输入之间的竞争。 */
function createWorkspace() {
  let workspace: ReturnType<typeof useWorkspaceState> | undefined;
  /** 在 Provider 中取得待验证的上下文。 */
  function Probe() {
    workspace = useWorkspaceState();
    return null;
  }
  renderToStaticMarkup(createElement(WorkspaceStateProvider, { children: createElement(Probe) }));
  return workspace!;
}

/** 新划词、手动编辑或语言更改必须同时废弃旧 OCR 的成功和失败事件。 */
test("new workspace work invalidates pending OCR events", () => {
  const workspace = createWorkspace();
  const mutations = [
    () => workspace.setOcrTextInput("new selected text", "selection"),
    () => workspace.setTextInput("edited text"),
    () => workspace.setTargetLang("fr"),
    () => workspace.beginTranslation(),
  ];
  for (const mutate of mutations) {
    const session = { sessionId: "capture", runId: workspace.beginTranslation() };
    expect(isCurrentOcrSession(session, "capture", workspace.isTranslationCurrent)).toBe(true);
    mutate();
    expect(isCurrentOcrSession(session, "capture", workspace.isTranslationCurrent)).toBe(false);
  }
});

/** 新截图开始后，旧会话事件不能消费或结束新截图的等待状态。 */
test("only the matching screenshot session may complete the current OCR", () => {
  const workspace = createWorkspace();
  const oldSession = { sessionId: "old", runId: workspace.beginTranslation() };
  const newSession = { sessionId: "new", runId: workspace.beginTranslation() };
  expect(isCurrentOcrSession(oldSession, "old", workspace.isTranslationCurrent)).toBe(false);
  expect(isCurrentOcrSession(newSession, "old", workspace.isTranslationCurrent)).toBe(false);
  expect(isCurrentOcrSession(newSession, "new", workspace.isTranslationCurrent)).toBe(true);
});

/** 已消费或卸载的截图会话不能接受重复完成通知。 */
test("completed or disposed OCR sessions reject duplicate events", () => {
  const workspace = createWorkspace();
  expect(isCurrentOcrSession(null, "capture", workspace.isTranslationCurrent)).toBe(false);
});
