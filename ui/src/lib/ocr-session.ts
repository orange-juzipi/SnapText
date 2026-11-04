/** 原生截图会话与主工作区任务代次的绑定。 */
export type OcrSession = {
  /** 截图创建时分配的唯一会话标识。 */
  sessionId: string;
  /** 接收 OCR 开始事件时取得的工作区任务代次。 */
  runId: number;
};

/** 仅接受仍拥有工作区的同一次截图事件，拒绝旧结果和旧失败。 */
export function isCurrentOcrSession(
  session: OcrSession | null,
  sessionId: string,
  isTranslationCurrent: (runId: number) => boolean,
) {
  return session !== null && session.sessionId === sessionId && isTranslationCurrent(session.runId);
}
