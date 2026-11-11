/** Where a conversation was left: how far down, whether at its end, and the last message it had shown. */
export interface ScrollPosition {
  top: number;
  atEnd: boolean;
  seq: number;
}

/** Remembers where a conversation was left; once the map holds `max`, the oldest are forgotten first. */
export function rememberPosition(
  positions: Map<string, ScrollPosition>,
  key: string,
  position: ScrollPosition,
  max: number,
): void {
  positions.delete(key);
  positions.set(key, position);
  // The oldest go first: the map keeps insertion order.
  for (const old of positions.keys()) {
    if (positions.size <= max) break;
    positions.delete(old);
  }
}

/** How many messages came after the one the reader had seen (none while they are at the end). */
export function missedAfter(
  items: ReadonlyArray<{ seq: number }>,
  awaySeq: number | null,
): number {
  return awaySeq === null ? 0 : items.filter((i) => i.seq > awaySeq).length;
}
