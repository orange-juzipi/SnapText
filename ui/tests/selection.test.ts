import { expect, test } from "bun:test";
import { boxFromPoints, selectionToRegion } from "../src/lib/selection";

/** 反向拖动也保留最终释放坐标，并按 Retina 比例换算。 */
test("converts the final drag position into physical screenshot pixels", () => {
  const selection = boxFromPoints(100, 90, 30, 20);
  expect(selectionToRegion(selection, { width: 800, height: 600 }, 400, 300))
    .toEqual({ x: 60, y: 40, width: 140, height: 140 });
});

/** 拖动超出预览时只提交截图内的有效区域。 */
test("clips selections at the image boundary", () => {
  expect(selectionToRegion({ x: -10, y: 290, width: 40, height: 30 }, { width: 800, height: 600 }, 400, 300))
    .toEqual({ x: 0, y: 580, width: 60, height: 20 });
});

/** 无效尺寸和点击不能产生原生命令中的空选区或非有限坐标。 */
test("rejects empty and non-finite selections", () => {
  const meta = { width: 800, height: 600 };
  expect(selectionToRegion(boxFromPoints(10, 10, 10, 10), meta, 400, 300)).toBeNull();
  expect(selectionToRegion({ x: NaN, y: 0, width: 10, height: 10 }, meta, 400, 300)).toBeNull();
  expect(selectionToRegion({ x: 0, y: 0, width: 10, height: 10 }, meta, 0, 300)).toBeNull();
});
