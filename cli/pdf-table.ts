/** PDF drawing bounds, transformed into the same coordinates as text items. */
export type Rect = readonly [number, number, number, number];
type Matrix = readonly [number, number, number, number, number, number];
export function tableRects(
  operations: { fnArray: number[]; argsArray: unknown[][] },
  ops: {
    save: number;
    restore: number;
    transform: number;
    constructPath: number;
  },
): Rect[] {
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const rectangles: Rect[] = [];
  for (let i = 0; i < operations.fnArray.length; i++) {
    const kind = operations.fnArray[i];
    const args = operations.argsArray[i]!;
    if (kind === ops.save) stack.push(matrix);
    else if (kind === ops.restore) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (kind === ops.transform) {
      const [a, b, c, d, e, f] = args as unknown as Matrix;
      const [g, h, j, k, l, m] = matrix;
      matrix = [
        g * a + j * b,
        h * a + k * b,
        g * c + j * d,
        h * c + k * d,
        g * e + j * f + l,
        h * e + k * f + m,
      ];
    } else if (kind === ops.constructPath) {
      const bounds = args[2];
      if (!(bounds instanceof Float32Array) || bounds.length !== 4) continue;
      const [x1, y1, x2, y2] = bounds as unknown as Rect;
      const [a, b, c, d, e, f] = matrix;
      const points = [
        [x1, y1],
        [x1, y2],
        [x2, y1],
        [x2, y2],
      ].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f]);
      const xs = points.map((p) => p[0]!);
      const ys = points.map((p) => p[1]!);
      rectangles.push([
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ]);
    }
  }
  return rectangles;
}
export function headerCell(
  rectangles: readonly Rect[],
  header: { x: number; y: number; width?: number },
): Rect | undefined {
  const x = header.x + (header.width ?? 0) / 2;
  return rectangles
    .filter(
      ([left, bottom, right, top]) =>
        left <= x &&
        right >= x &&
        bottom < header.y &&
        top > header.y &&
        right - left > 20 &&
        top - bottom > 10,
    )
    .sort(
      (a, b) => (a[2] - a[0]) * (a[3] - a[1]) - (b[2] - b[0]) * (b[3] - b[1]),
    )[0];
}
