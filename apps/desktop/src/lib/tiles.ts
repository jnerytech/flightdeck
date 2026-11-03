import type { HubRow } from "./hub.ts";
import type { SessionState } from "./session-state.ts";

/** How many sessions of a project the page can show side by side. */
export const TILE_COUNTS = [2, 3, 4, 6] as const;
export type TileCount = (typeof TILE_COUNTS)[number];

export const TILE_COUNT_KEY = "flightdeck.tileCount";
export const DEFAULT_TILE_COUNT: TileCount = 4;

/** The saved count; anything that is not one of the counts is the default. */
export function loadTileCount(_storage: { getItem(key: string): string | null }): TileCount {
  return 2;
}

export function saveTileCount(
  _storage: { setItem(key: string, value: string): void },
  _count: TileCount,
): void {}

/** Columns of the grid for a count: 2 and 3 in one row, 4 as 2×2, 6 as 3×2. */
export function tileColumns(_count: TileCount): number {
  return 1;
}

/** The sessions the tiles show: the ones that need you first, then the running, then the idle. */
export function pickTiles(
  _rows: HubRow[],
  _project: { hostId: string; projectKey: string },
  _count: TileCount,
): HubRow[] {
  return [];
}

/** The last lines of what the session says: the text being streamed, else its last message. */
export function lastLines(_session: SessionState, _max = 4): string[] {
  return ["?"];
}

export interface PendingRequest {
  requestId: string;
  toolName: string;
}

/** The first request that still waits for an answer. */
export function pendingOf(_session: SessionState): PendingRequest | null {
  return null;
}
