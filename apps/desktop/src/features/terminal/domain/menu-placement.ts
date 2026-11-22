interface Point {
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}

/**
 * Where a menu of `size` opened at `point` goes so it stays inside `viewport`: the click point when
 * it fits, else pulled back from the right and bottom edges. A viewport smaller than the menu puts
 * it at the top-left, never past the left or top edge (#3953).
 */
export function clampMenu(point: Point, size: Size, viewport: Size): Point {
  return {
    x: Math.max(0, Math.min(point.x, viewport.width - size.width)),
    y: Math.max(0, Math.min(point.y, viewport.height - size.height)),
  };
}
