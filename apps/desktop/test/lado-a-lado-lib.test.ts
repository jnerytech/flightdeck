import { describe, expect, test } from "bun:test";
import type { HubRow } from "../src/lib/hub.ts";
import { emptySession, type SessionState } from "../src/lib/session-state.ts";
import {
  DEFAULT_TILE_COUNT,
  lastLines,
  loadTileCount,
  pendingOf,
  pickTiles,
  saveTileCount,
  TILE_COUNT_KEY,
  TILE_COUNTS,
  tileColumns,
} from "../src/lib/tiles.ts";

const row = (n: number, over: Partial<HubRow> = {}): HubRow => ({
  key: `h/m/s${n}`,
  hostId: "h",
  hostName: "host",
  origin: "flightdeck",
  claudeSessionId: `c${n}`,
  sessionId: `s${n}`,
  title: `sessão ${n}`,
  cwd: "/p",
  projectKey: "proj",
  state: "idle",
  controllable: false,
  lastActivity: `2026-11-03T10:0${n}:00.000Z`,
  pinned: false,
  archived: false,
  summary: null,
  persona: null,
  ...over,
});

const project = { hostId: "h", projectKey: "proj" };

describe("lado-a-lado: which sessions the tiles show", () => {
  test("the counts are 2, 3, 4 and 6, and the grid has 2, 3, 2 and 3 columns", () => {
    expect([...TILE_COUNTS]).toEqual([2, 3, 4, 6]);
    expect(TILE_COUNTS.map(tileColumns)).toEqual([2, 3, 2, 3]);
  });

  test("only the project's live managed sessions, the ones that need you first, then running, then idle", () => {
    const rows = [
      row(1, { state: "idle" }),
      row(2, { state: "running" }),
      row(3, { state: "needs_you" }),
      row(4, { state: "ended" }),
      row(5, { origin: "terminal", sessionId: null }),
      row(6, { projectKey: "outro" }),
      row(7, { hostId: "x" }),
      row(8, { archived: true }),
      row(9, { state: "idle", lastActivity: "2026-11-03T12:00:00.000Z" }),
    ];
    expect(pickTiles(rows, project, 6).map((r) => r.sessionId)).toEqual(["s3", "s2", "s9", "s1"]);
  });

  test("it stops at the count, and the same state is ordered by the latest activity", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row(n, { state: "running" }));
    expect(pickTiles(rows, project, 2).map((r) => r.sessionId)).toEqual(["s5", "s4"]);
  });
});

describe("lado-a-lado: what a tile shows", () => {
  const withText = (text: string, streaming = ""): SessionState => ({
    ...emptySession(),
    streaming,
    items: [
      { kind: "user", seq: 1, text: "pergunta" },
      { kind: "assistant", seq: 2, blocks: [{ type: "text", text }] },
    ],
  });

  test("the last lines of the last message, without blank lines, at most four", () => {
    expect(lastLines(withText("a\n\nb\n  c  \nd\ne"))).toEqual(["b", "c", "d", "e"]);
    expect(lastLines(withText("a\nb\nc"), 2)).toEqual(["b", "c"]);
  });

  test("the text being streamed wins over the last message", () => {
    expect(lastLines(withText("velho", "novo\nainda escrevendo"))).toEqual([
      "novo",
      "ainda escrevendo",
    ]);
  });

  test("a session with nothing said has no lines", () => {
    expect(lastLines(emptySession())).toEqual([]);
  });

  test("the pending request is the first permission still open", () => {
    const base = emptySession();
    const asked = (requestId: string, resolved = false) => ({
      kind: "permission" as const,
      seq: 3,
      requestId,
      toolName: "Write",
      input: {} as never,
      ...(resolved ? { resolution: { decision: "allow" as const } } : {}),
    });
    const session: SessionState = {
      ...base,
      pending: ["r2"],
      items: [asked("r1", true), asked("r2")],
    };
    expect(pendingOf(session)).toEqual({ requestId: "r2", toolName: "Write" });
    expect(pendingOf({ ...session, pending: [] })).toBeNull();
    expect(pendingOf(base)).toBeNull();
  });
});

describe("lado-a-lado: the saved count", () => {
  const store = (initial?: string) => {
    const data = new Map<string, string>(initial ? [[TILE_COUNT_KEY, initial]] : []);
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  };

  test("it comes back as saved, and anything else is the default", () => {
    const storage = store();
    expect(loadTileCount(storage)).toBe(DEFAULT_TILE_COUNT);
    saveTileCount(storage, 6);
    expect(loadTileCount(storage)).toBe(6);
    expect(loadTileCount(store("5"))).toBe(DEFAULT_TILE_COUNT);
    expect(loadTileCount(store("lixo"))).toBe(DEFAULT_TILE_COUNT);
  });
});
