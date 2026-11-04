import { expect, test } from "bun:test";
import { runTranslationTask, translationContext } from "../src/lib/translation-task";
import type { WorkspaceSnapshot } from "../src/lib/types";

/** 手动决定网络请求完成顺序，覆盖真实调用中可能出现的乱序。 */
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** 迟到的图片结果不能覆盖已完成的新划词结果，也不能结束新任务的加载状态。 */
test("an old image response cannot replace a newer selection", async () => {
  let current = 1;
  const oldImage = deferred<string>();
  const newSelection = deferred<string>();
  const applied: string[] = [];
  const finished: number[] = [];
  const errors: unknown[] = [];
  const image = runTranslationTask({
    id: 1, isCurrent: (id) => id === current, run: () => oldImage.promise,
    apply: (value) => applied.push(value), fail: (error) => errors.push(error), finish: () => finished.push(1),
  });
  current = 2;
  const selection = runTranslationTask({
    id: 2, isCurrent: (id) => id === current, run: () => newSelection.promise,
    apply: (value) => applied.push(value), fail: (error) => errors.push(error), finish: () => finished.push(2),
  });
  newSelection.resolve("new selection");
  await selection;
  oldImage.resolve("old image");
  await image;
  expect(applied).toEqual(["new selection"]);
  expect(finished).toEqual([2]);
  expect(errors).toEqual([]);
});

/** 已取消或离开页面的请求失败时，不能向新工作区显示错误。 */
test("cancelled and unmounted tasks ignore late errors", async () => {
  let mounted = true;
  const response = deferred<string>();
  const actions: string[] = [];
  const task = runTranslationTask({
    id: 1, isCurrent: () => mounted, run: () => response.promise,
    apply: () => actions.push("apply"), fail: () => actions.push("fail"), finish: () => actions.push("finish"),
  });
  mounted = false;
  response.reject(new Error("old request failed"));
  await task;
  expect(actions).toEqual([]);
});

/** 当前任务的成功/失败都应先释放加载状态，然后更新结果或显示错误。 */
test("current tasks release loading before committing success or failure", async () => {
  const actions: string[] = [];
  await runTranslationTask({
    id: 1, isCurrent: () => true, run: async () => "translated",
    apply: () => actions.push("apply"), fail: () => actions.push("fail"), finish: () => actions.push("finish"),
  });
  await runTranslationTask({
    id: 2, isCurrent: () => true, run: async () => { throw new Error("failed"); },
    apply: () => actions.push("apply"), fail: () => actions.push("fail"), finish: () => actions.push("finish"),
  });
  expect(actions).toEqual(["finish", "apply", "finish", "fail"]);
});

/** 截图重新翻译保留来源和置信度；编辑原文后不再传递失效的坐标。 */
test("translation context preserves source and only matching OCR coordinates", () => {
  const snapshot: WorkspaceSnapshot = {
    result: "", sourceText: "recognized", sourceKind: "screenshot", targetLang: "fr",
    dictionaryEntries: [], requiresReview: false,
    textLines: [{ text: "recognized", confidence: 0.2, bbox: { x: 0, y: 0, width: 100, height: 20 } }],
  };
  expect(translationContext(snapshot, "recognized")).toEqual({ source: "screenshot", textLines: snapshot.textLines });
  expect(translationContext(snapshot, "corrected")).toEqual({ source: "screenshot", textLines: [] });
  expect(translationContext({ ...snapshot, sourceKind: "" }, "typed")).toEqual({ source: "text", textLines: [] });
});
