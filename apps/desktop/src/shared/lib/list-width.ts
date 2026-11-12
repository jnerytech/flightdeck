export const LIST_MIN = 280;
export const LIST_MAX = 640;
export const LIST_DEFAULT = 380;

/** Where the list column's width is kept. */
export const LIST_WIDTH_KEY = "flightdeck.listWidth";

export const clampListWidth = (width: number) => Math.min(LIST_MAX, Math.max(LIST_MIN, width));

/** The stored width, or the default when it is missing or nonsense. */
export function loadListWidth(storage: { getItem(key: string): string | null }): number {
  const stored = Number(storage.getItem(LIST_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampListWidth(stored) : LIST_DEFAULT;
}
