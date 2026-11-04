import type { HubRow, HubState } from "./hub.ts";
import { isInside } from "./paths.ts";
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

const ORDER: Partial<Record<HubState, number>> = { needs_you: 0, running: 1, idle: 2 };

/** The sessions the tiles show: the ones that need you first, then the running, then the idle. */
export function pickTiles(
  rows: HubRow[],
  project: { hostId: string; projectKey: string; path?: string },
  count: TileCount,
): HubRow[] {
  return rows
    .filter(
      (row) =>
        row.sessionId !== null &&
        row.origin === "flightdeck" &&
        !row.archived &&
        row.hostId === project.hostId &&
        // The daemon keys a session by its folder until git has been asked, so the folder counts too.
        (row.projectKey === project.projectKey ||
          (project.path !== undefined && isInside(row.cwd, project.path))) &&
        ORDER[row.state] !== undefined,
    )
    .sort(
      (a, b) =>
        (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) ||
        b.lastActivity.localeCompare(a.lastActivity),
    )
    .slice(0, count);
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
