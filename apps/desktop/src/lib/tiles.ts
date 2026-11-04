import type { HubRow, HubState } from "./hub.ts";
import type { SessionState } from "./session-state.ts";

/** How many sessions of a project the page can show side by side. */
export const TILE_COUNTS = [2, 3, 4, 6] as const;
export type TileCount = (typeof TILE_COUNTS)[number];

export const TILE_COUNT_KEY = "flightdeck.tileCount";
export const DEFAULT_TILE_COUNT: TileCount = 4;

/** The saved count; anything that is not one of the counts is the default. */
export function loadTileCount(storage: { getItem(key: string): string | null }): TileCount {
  const saved = Number(storage.getItem(TILE_COUNT_KEY));
  return TILE_COUNTS.find((count) => count === saved) ?? DEFAULT_TILE_COUNT;
}

export function saveTileCount(
  storage: { setItem(key: string, value: string): void },
  count: TileCount,
): void {
  storage.setItem(TILE_COUNT_KEY, String(count));
}

/** Columns of the grid for a count: 2 and 3 in one row, 4 as 2×2, 6 as 3×2. */
export function tileColumns(count: TileCount): number {
  return count === 2 || count === 4 ? 2 : 3;
}

/** The layouts of the tiles (issue #94): a grid drawn by an icon, or Auto for every live session. */
export const TILE_LAYOUTS = ["2", "3", "2x2", "2x3", "auto"] as const;
export type TileLayout = (typeof TILE_LAYOUTS)[number];
export const DEFAULT_TILE_LAYOUT: TileLayout = "2";

/** The saved layout; the old counts 4 and 6 are the 2×2 and 2×3 grids they were. */
export function loadTileLayout(_storage: { getItem(key: string): string | null }): TileLayout {
  return DEFAULT_TILE_LAYOUT;
}

export function saveTileLayout(
  _storage: { setItem(key: string, value: string): void },
  _layout: TileLayout,
): void {}

/** How many tiles a layout holds; `null` for Auto, which holds every live session. */
export function tileSlots(_layout: TileLayout): number | null {
  return 0;
}

/** The columns of the grid for a layout, given how many tiles are shown. */
export function tileColumns2(_layout: TileLayout, _shown: number): number {
  return 1;
}

/** The live sessions the layout cannot show. */
export function hiddenTiles(
  _rows: HubRow[],
  _project: { hostId: string; projectKey: string },
  _layout: TileLayout,
): number {
  return 0;
}

const ORDER: Partial<Record<HubState, number>> = { needs_you: 0, running: 1, idle: 2 };

/** The sessions the tiles show: the ones that need you first, then the running, then the idle. */
export function pickTiles(
  rows: HubRow[],
  project: { hostId: string; projectKey: string },
  count: TileCount | TileLayout,
): HubRow[] {
  return rows
    .filter(
      (row) =>
        row.sessionId !== null &&
        row.origin === "flightdeck" &&
        !row.archived &&
        row.hostId === project.hostId &&
        row.projectKey === project.projectKey &&
        ORDER[row.state] !== undefined,
    )
    .sort(
      (a, b) =>
        (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) ||
        b.lastActivity.localeCompare(a.lastActivity),
    )
    .slice(0, typeof count === "number" ? count : 0);
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** The last lines of what the session says: the text being streamed, else its last message. */
export function lastLines(session: SessionState, max = 4): string[] {
  if (session.streaming !== "") return lines(session.streaming).slice(-max);
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i];
    if (item?.kind !== "assistant") continue;
    const text = item.blocks.flatMap((block) => (block.type === "text" ? [block.text] : []));
    const found = lines(text.join("\n"));
    if (found.length > 0) return found.slice(-max);
  }
  return [];
}

export interface PendingRequest {
  requestId: string;
  toolName: string;
}

/** The first request that still waits for an answer. */
export function pendingOf(session: SessionState): PendingRequest | null {
  for (const item of session.items) {
    if (
      item.kind === "permission" &&
      !item.resolution &&
      session.pending.includes(item.requestId)
    ) {
      return { requestId: item.requestId, toolName: item.toolName };
    }
  }
  return null;
}
