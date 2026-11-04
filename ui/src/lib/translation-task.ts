import type { TextLine, WorkspaceSnapshot } from "@/lib/types";

/** 一次异步任务的所有权检查和界面提交动作。 */
type TranslationTask<T> = {
  /** 开始任务时取得的工作区代次。 */
  id: number;
  /** 同时检查页面生命周期和工作区代次。 */
  isCurrent: (id: number) => boolean;
  /** 执行 OCR 或翻译请求。 */
  run: () => Promise<T>;
  /** 只为当前任务写入成功结果。 */
  apply: (result: T) => void;
  /** 只为当前任务展示失败。 */
  fail: (error: unknown) => void;
  /** 在提交结果可能改变代次之前结束当前任务的加载状态。 */
  finish: () => void;
};

/** 统一阻止迟到的结果、错误和清理动作影响较新的工作区任务。 */
export async function runTranslationTask<T>(task: TranslationTask<T>): Promise<void> {
  let result: T;
  try {
    result = await task.run();
  } catch (error) {
    if (task.isCurrent(task.id)) {
      task.finish();
      task.fail(error);
    }
    return;
  }
  if (!task.isCurrent(task.id)) return;
  task.finish();
  task.apply(result);
}

/** 保留 OCR 来源，但仅在原文仍完全匹配时复用对应的坐标和置信度。 */
export function translationContext(snapshot: WorkspaceSnapshot, sourceText: string): {
  /** 用于历史记录的真实来源。 */
  source: string;
  /** 与当前原文匹配的 OCR 行。 */
  textLines: TextLine[];
} {
  return {
    source: ["image", "screenshot", "selection"].includes(snapshot.sourceKind) ? snapshot.sourceKind : "text",
    textLines: snapshot.sourceText.trim() === sourceText.trim() ? snapshot.textLines : [],
  };
}
