import { describe, expect, test } from "bun:test";
import type { HubRow } from "../src/lib/hub.ts";
import {
  DEFAULT_TILE_LAYOUT,
  hiddenTiles,
  loadTileLayout,
  pickTiles,
  saveTileLayout,
  TILE_COUNT_KEY,
  TILE_LAYOUTS,
  tileColumns,
  tileSlots,
} from "../src/lib/tiles.ts";

const row = (n: number): HubRow => ({
  key: `h/m/s${n}`,
  hostId: "h",
  hostName: "host",
  origin: "flightdeck",
  claudeSessionId: `c${n}`,
  sessionId: `s${n}`,
  title: `sessão ${n}`,
  cwd: "/p",
  projectKey: "proj",
  state: "running",
  controllable: false,
  lastActivity: `2026-11-03T10:${String(n).padStart(2, "0")}:00.000Z`,
  pinned: false,
  archived: false,
  summary: null,
  persona: null,
});
const project = { hostId: "h", projectKey: "proj" };
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

describe("tiles-layout: a grid drawn by an icon", () => {
  test("the layouts are 2, 3, 2×2, 2×3 and Auto, and Auto is the default", () => {
    expect([...TILE_LAYOUTS]).toEqual(["2", "3", "2x2", "2x3", "auto"]);
    expect(DEFAULT_TILE_LAYOUT).toBe("auto");
  });

  test("each layout holds 2, 3, 4 or 6 tiles, and Auto holds every live session", () => {
    expect(TILE_LAYOUTS.map(tileSlots)).toEqual([2, 3, 4, 6, null]);
  });

  test("the columns follow the layout, and Auto fits the sessions it shows", () => {
    expect(["2", "3", "2x2", "2x3"].map((l) => tileColumns(l as never, 6))).toEqual([2, 3, 2, 3]);
    expect([1, 2, 3, 4, 5, 6, 7, 9, 10].map((n) => tileColumns("auto", n))).toEqual([
      1, 2, 3, 2, 3, 3, 3, 3, 4,
    ]);
  });

  test("a layout shows its slots, Auto shows all, and the hint counts what is left out", () => {
    expect(pickTiles(rows(7), project, "2x2")).toHaveLength(4);
    expect(pickTiles(rows(7), project, "auto")).toHaveLength(7);
    expect(hiddenTiles(rows(7), project, "2")).toBe(5);
    expect(hiddenTiles(rows(7), project, "auto")).toBe(0);
    expect(hiddenTiles(rows(2), project, "2x3")).toBe(0);
  });

  test("the saved layout comes back; the old counts 4 and 6 are 2×2 and 2×3; anything else is Auto", () => {
    const store = (initial?: string) => {
      const data = new Map<string, string>(initial ? [[TILE_COUNT_KEY, initial]] : []);
      return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      };
    };
    const storage = store();
    expect(loadTileLayout(storage)).toBe("auto");
    saveTileLayout(storage, "2x3");
    expect(loadTileLayout(storage)).toBe("2x3");
    expect(loadTileLayout(store("4"))).toBe("2x2");
    expect(loadTileLayout(store("6"))).toBe("2x3");
    expect(loadTileLayout(store("2"))).toBe("2");
    expect(loadTileLayout(store("5"))).toBe("auto");
    expect(loadTileLayout(store("lixo"))).toBe("auto");
  });
});
