import { expect, it } from "vitest";
import { tableRects, headerCell } from "../cli/pdf-table";
it("transforms PDF cell rectangles and restores the drawing coordinate system", () => {
  const ops = { save: 1, restore: 2, transform: 3, constructPath: 4 };
  const rects = tableRects(
    {
      fnArray: [1, 3, 4, 2, 4, 4],
      argsArray: [
        [],
        [1, 0, 0, -1, 0, 700],
        [28, [], new Float32Array([380, 60, 480, 90])],
        [],
        [28, [], new Float32Array([0, 0, 800, 700])],
        [28, []],
      ],
    },
    ops,
  );
  expect(rects).toEqual([
    [380, 610, 480, 640],
    [0, 0, 800, 700],
  ]);
  expect(headerCell(rects, { x: 410, y: 620, width: 33 })).toEqual([
    380, 610, 480, 640,
  ]);
  expect(headerCell([], { x: 0, y: 0 })).toBeUndefined();
});
