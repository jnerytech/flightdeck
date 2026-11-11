/** Where a conversation was left: how far down, whether at its end, and the last message it had shown. */
export interface ScrollPosition {
  top: number;
  atEnd: boolean;
  seq: number;
}

/** Remembers where a conversation was left; once the map holds `max`, the oldest are forgotten first. */
export function rememberPosition(
  _positions: Map<string, ScrollPosition>,
  _key: string,
  _position: ScrollPosition,
  _max: number,
): void {}

/** How many messages came after the one the reader had seen (none while they are at the end). */
export function missedAfter(
  _items: ReadonlyArray<{ seq: number }>,
  _awaySeq: number | null,
): number {
  return -1;
}
