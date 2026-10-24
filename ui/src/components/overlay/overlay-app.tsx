import { useEffect, useRef, useState } from "react";
import { Languages, ScanText } from "lucide-react";
import { closeOverlay, events, getOverlayScreenshot, ocrOverlaySelection } from "@/lib/api";
import { labelsForLanguage } from "@/lib/labels";
import { useConfigQuery } from "@/lib/queries";
import { boxFromPoints, selectionToRegion, type SelectionBox } from "@/lib/selection";
import { tauriEmit, tauriListen } from "@/lib/tauri";
import type { ScreenshotPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";

type DragState = {
  /** 当前拖动所用的指针，避免其他按钮或触点提交选区。 */
  pointerId: number;
  /** 拖动起点横坐标。 */
  startX: number;
  /** 拖动起点纵坐标。 */
  startY: number;
};

/** 展示截图并将一次主指针拖动提交为 OCR 选区。 */
export function OverlayApp() {
  const configQuery = useConfigQuery();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const [status, setStatus] = useState(labels.preparingOverlay);
  const [screenshot, setScreenshot] = useState<ScreenshotPayload | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const processingRef = useRef(false);
  const screenshotVersionRef = useRef(0);
  const [processing, setProcessing] = useState(false);
  const [selection, setSelection] = useState<SelectionBox | null>(null);
  const [translateAfterOcr, setTranslateAfterOcr] = useState(true);

  /** 订阅截图刷新并读取初始截图，卸载后丢弃迟到的响应。 */
  useEffect(() => {
    let disposed = false;
    let eventVersion = 0;
    let unlisten: (() => void) | undefined;

    /** Applies the latest native screenshot and clears state left by the previous overlay session. */
    function applyScreenshot(payload: ScreenshotPayload | null) {
      if (disposed) return;
      screenshotVersionRef.current += 1;
      setScreenshot(payload);
      dragRef.current = null;
      processingRef.current = false;
      setProcessing(false);
      setSelection(null);
      setStatus(payload ? labelsRef.current.overlayInstruction : labelsRef.current.noOverlayScreenshot);
    }

    /** Registers refresh delivery before reading state so a newly emitted screenshot cannot be missed. */
    async function initializeScreenshotSync() {
      try {
        const cleanup = await tauriListen<ScreenshotPayload>(events.overlayScreenshot, (event) => {
          // 新截图事件优先于尚未返回的初始截图读取。
          eventVersion += 1;
          applyScreenshot(event.payload);
        });
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;

        const versionBeforeLoad = eventVersion;
        const payload = await getOverlayScreenshot();
        // A refresh event received during the command already contains the newer screenshot.
        if (eventVersion === versionBeforeLoad) applyScreenshot(payload);
      } catch (error) {
        if (!disposed) setStatus(error instanceof Error ? error.message : String(error));
      }
    }

    void initializeScreenshotSync();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  /** 将键盘取消与当前截图会话保持同步，并移除过期监听。 */
  useEffect(() => {
    /** Escape 与取消按钮使用相同的原生关闭路径。 */
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") void handleCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /** 取消当前会话，使仍在等待的 OCR 结果不能关闭下一次截图。 */
  async function handleCancel() {
    screenshotVersionRef.current += 1;
    dragRef.current = null;
    try {
      await closeOverlay(screenshot?.session_id);
      setStatus(labels.overlayClosed);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** 从释放位置生成最终选区；一个截图会话同时只提交一次 OCR。 */
  async function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || event.button !== 0) return;
    dragRef.current = null;
    if (!screenshot || processingRef.current) return;
    const point = eventPoint(event);
    const finalSelection = boxFromPoints(drag.startX, drag.startY, point.x, point.y);
    setSelection(finalSelection);
    const rect = event.currentTarget.getBoundingClientRect();
    const region = selectionToRegion(finalSelection, screenshot.meta, rect.width, rect.height);
    if (!region) {
      setStatus(labels.selectedRegionTooSmall);
      return;
    }
    const screenshotVersion = screenshotVersionRef.current;
    processingRef.current = true;
    setProcessing(true);
    setStatus(labels.ocrSelectedRegion);
    try {
      // The main window owns the input box, so announce OCR start before the blocking command.
      await tauriEmit(events.overlayOcrStarted, region);
      if (screenshotVersion !== screenshotVersionRef.current) return;
      await ocrOverlaySelection(region, translateAfterOcr, screenshot.session_id);
      if (screenshotVersion === screenshotVersionRef.current) await closeOverlay(screenshot.session_id);
    } catch (error) {
      if (screenshotVersion !== screenshotVersionRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      // 发送失败通知本身也可能失败，不能让它覆盖原始错误或形成未处理拒绝。
      await tauriEmit(events.overlayOcrFailed, { ...region, message }).catch(() => undefined);
      setStatus(message);
    } finally {
      if (screenshotVersion === screenshotVersionRef.current) {
        processingRef.current = false;
        setProcessing(false);
      }
    }
  }

  return (
    <main aria-busy={processing} className="fixed inset-0 overflow-hidden bg-transparent" onContextMenu={(event) => event.preventDefault()}>
      {screenshot ? (
        <img
          alt=""
          className="fixed inset-0 h-full w-full select-none object-fill"
          draggable={false}
          src={`data:image/png;base64,${screenshot.base64_png}`}
        />
      ) : null}
      <div className="overlay-status-bar fixed left-3 right-3 top-3 z-10 flex min-h-10 items-center justify-between gap-3 rounded-lg border border-white/15 bg-slate-950/80 px-3 py-2 text-sm text-white">
        <span role="status" aria-live="polite">{status}</span>
        <div className="overlay-mode-actions">
          <div className="overlay-mode-control" role="group" aria-label={labels.overlayResultMode}>
            <Button
              size="sm"
              type="button"
              aria-pressed={!translateAfterOcr}
              disabled={processing}
              variant={translateAfterOcr ? "ghost" : "primary"}
              className="text-white hover:bg-white/10"
              onClick={() => setTranslateAfterOcr(false)}
            >
              <ScanText size={14} />
              {labels.imageOcrOnly}
            </Button>
            <Button
              size="sm"
              type="button"
              aria-pressed={translateAfterOcr}
              disabled={processing}
              variant={translateAfterOcr ? "primary" : "ghost"}
              className="text-white hover:bg-white/10"
              onClick={() => setTranslateAfterOcr(true)}
            >
              <Languages size={14} />
              {labels.imageOcrAndTranslate}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={handleCancel}>
            {labels.cancel}
          </Button>
        </div>
      </div>
      <div
        className={`fixed inset-0 ${processing ? "cursor-wait" : "cursor-crosshair"}`}
        onPointerDown={(event) => {
          // 只允许当前主指针在空闲会话开始选区，并持续捕获该指针。
          if (event.button !== 0 || !event.isPrimary || !screenshot || processingRef.current) return;
          const point = eventPoint(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, startX: point.x, startY: point.y };
          setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
        }}
        onPointerMove={(event) => {
          // 仅更新建立选区的指针，避免多触点互相覆盖。
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const point = eventPoint(event);
          setSelection(boxFromPoints(drag.startX, drag.startY, point.x, point.y));
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          // 指针被系统取消时同时丢弃拖动状态和预览框。
          dragRef.current = null; setSelection(null);
        }}
        onLostPointerCapture={() => {
          // 捕获结束后禁止迟到的移动事件继续改变选区。
          dragRef.current = null;
        }}
      >
        {selection ? (
          <span
            className="overlay-selection-box absolute block border-2 border-primary bg-primary/20"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

/** 把屏幕指针坐标限制在预览画布之内。 */
function eventPoint(event: React.PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    /** 相对画布左侧且已裁剪的横坐标。 */
    x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
    /** 相对画布顶部且已裁剪的纵坐标。 */
    y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
  };
}
