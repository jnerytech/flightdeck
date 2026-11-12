/** Whether a sideways scroller has more to show on its right (one pixel of slack for rounding). */
export function canScrollRight(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): boolean {
  return scrollLeft + clientWidth < scrollWidth - 1;
}
