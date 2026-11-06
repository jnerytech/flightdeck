/** Where a card sits on screen: enough to tell its row and its column. */
export interface CardSpot {
  left: number;
  top: number;
}

/** The nearest card, by column, in the closest row above (`-1`) or below (`1`). */
function nextRow(spots: CardSpot[], from: number, direction: 1 | -1): number | null {
  const here = spots[from];
  if (!here) return null;
  const beyond = spots
    .map((spot, index) => ({ spot, index }))
    .filter(({ spot }) => (spot.top - here.top) * direction > 1);
  if (beyond.length === 0) return null;
  const rowTop = beyond.reduce(
    (best, { spot }) =>
      Math.abs(spot.top - here.top) < Math.abs(best - here.top) ? spot.top : best,
    beyond[0]?.spot.top ?? here.top,
  );
  const row = beyond.filter(({ spot }) => Math.abs(spot.top - rowTop) <= 1);
  return row.reduce((best, item) =>
    Math.abs(item.spot.left - here.left) < Math.abs(best.spot.left - here.left) ? item : best,
  ).index;
}

/**
 * The card an arrow key moves to in a grid of cards (#669), or `null` when it stays: left and
 * right walk the order, up and down go to the nearest card in the row above or below, Home and
 * End to the first and the last. The grid's column count follows its container, so the rows are
 * read from where the cards sit.
 */
export function gridStep(spots: CardSpot[], from: number, key: string): number | null {
  const last = spots.length - 1;
  switch (key) {
    case "ArrowRight":
      return from < last ? from + 1 : null;
    case "ArrowLeft":
      return from > 0 ? from - 1 : null;
    case "ArrowDown":
      return nextRow(spots, from, 1);
    case "ArrowUp":
      return nextRow(spots, from, -1);
    case "Home":
      return last >= 0 ? 0 : null;
    case "End":
      return last >= 0 ? last : null;
    default:
      return null;
  }
}
