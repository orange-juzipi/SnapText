import { useEffect, useState } from "react";
import { Languages, ScanText } from "lucide-react";
import { closeOverlay, events, getOverlayScreenshot, ocrOverlaySelection } from "@/lib/api";
import { labelsForLanguage } from "@/lib/labels";
import { tauriEmit } from "@/lib/tauri";
import type { Region, ScreenshotMeta, ScreenshotPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";

type SelectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragState = {
  startX: number;
  startY: number;
};

export function OverlayApp() {
  const labels = labelsForLanguage("zh_cn");
  const [status, setStatus] = useState(labels.preparingOverlay);
  const [screenshot, setScreenshot] = useState<ScreenshotPayload | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selection, setSelection] = useState<SelectionBox | null>(null);
  const [translateAfterOcr, setTranslateAfterOcr] = useState(true);

  useEffect(() => {
    getOverlayScreenshot()
      .then((payload) => {
        if (payload) {
          setScreenshot(payload);
          setStatus(labels.overlayInstruction);
        } else {
          setStatus(labels.noOverlayScreenshot);
        }
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") void handleCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function handleCancel() {
    try {
      await closeOverlay();
      setStatus(labels.overlayClosed);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!screenshot || !selection) {
      setDrag(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const region = selectionToRegion(selection, screenshot.meta, rect.width, rect.height);
    setDrag(null);
    if (!region) {
      setStatus(labels.selectedRegionTooSmall);
      return;
    }
    setStatus(labels.ocrSelectedRegion);
    try {
      // The main window owns the input box, so announce OCR start before the blocking command.
      await tauriEmit(events.overlayOcrStarted, region);
      await ocrOverlaySelection(region, translateAfterOcr);
      await closeOverlay();
    } catch (error) {
      await tauriEmit(events.overlayOcrFailed, region);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-transparent" onContextMenu={(event) => event.preventDefault()}>
      {screenshot ? (
        <img
          alt=""
          className="fixed inset-0 h-full w-full select-none object-fill"
          draggable={false}
          src={`data:image/png;base64,${screenshot.base64_png}`}
        />
      ) : null}
      <div className="overlay-status-bar fixed left-3 right-3 top-3 z-10 flex min-h-10 items-center justify-between gap-3 rounded-lg border border-white/15 bg-slate-950/80 px-3 py-2 text-sm text-white">
        <span>{status}</span>
        <div className="overlay-mode-actions">
          <div className="overlay-mode-control" role="group" aria-label={labels.overlayResultMode}>
            <Button
              size="sm"
              type="button"
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
        className="fixed inset-0 cursor-crosshair"
        onPointerDown={(event) => {
          const point = eventPoint(event);
          setDrag({ startX: point.x, startY: point.y });
          setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const point = eventPoint(event);
          setSelection(boxFromPoints(drag.startX, drag.startY, point.x, point.y));
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
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

function eventPoint(event: React.PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
    y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
  };
}

function boxFromPoints(startX: number, startY: number, endX: number, endY: number): SelectionBox {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function selectionToRegion(
  selection: SelectionBox,
  meta: ScreenshotMeta,
  previewWidth: number,
  previewHeight: number,
): Region | null {
  if (!meta.width || !meta.height || previewWidth <= 0 || previewHeight <= 0) return null;
  if (selection.width < 2 || selection.height < 2) return null;
  const scaleX = meta.width / previewWidth;
  const scaleY = meta.height / previewHeight;
  const left = clamp(Math.round(selection.x * scaleX), 0, meta.width);
  const top = clamp(Math.round(selection.y * scaleY), 0, meta.height);
  const right = clamp(Math.round((selection.x + selection.width) * scaleX), 0, meta.width);
  const bottom = clamp(Math.round((selection.y + selection.height) * scaleY), 0, meta.height);
  if (right <= left || bottom <= top) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
