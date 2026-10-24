import type { Region, ScreenshotMeta } from "@/lib/types";

/** 浏览器预览中的选区，单位为 CSS 像素。 */
export type SelectionBox = {
  /** 选区左边缘。 */
  x: number;
  /** 选区上边缘。 */
  y: number;
  /** 选区宽度。 */
  width: number;
  /** 选区高度。 */
  height: number;
};

/** 根据拖动起点和最终释放坐标生成任意方向的选区。 */
export function boxFromPoints(startX: number, startY: number, endX: number, endY: number): SelectionBox {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

/** 将预览选区换算为截图物理像素，并拒绝不可识别或无效的边界。 */
export function selectionToRegion(
  selection: SelectionBox,
  meta: ScreenshotMeta,
  previewWidth: number,
  previewHeight: number,
): Region | null {
  const values = [selection.x, selection.y, selection.width, selection.height, meta.width, meta.height, previewWidth, previewHeight];
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (meta.width <= 0 || meta.height <= 0 || previewWidth <= 0 || previewHeight <= 0) return null;
  if (selection.width < 2 || selection.height < 2) return null;
  const scaleX = meta.width / previewWidth;
  const scaleY = meta.height / previewHeight;
  const left = clamp(Math.round(selection.x * scaleX), 0, meta.width);
  const top = clamp(Math.round(selection.y * scaleY), 0, meta.height);
  const right = clamp(Math.round((selection.x + selection.width) * scaleX), 0, meta.width);
  const bottom = clamp(Math.round((selection.y + selection.height) * scaleY), 0, meta.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 将坐标限制在实际截图范围内。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
