import { describe, expect, test } from "bun:test";
import type { BgList, BgSession } from "@flightdeck/protocol";
import {
  type BackgroundCore,
  BackgroundSlice,
  initialBackgroundState,
} from "../../src/features/background/index.ts";

const LIST = { sessions: [{ id: "s1" }] } as unknown as BgList;
const SESSION = { id: "s1", cwd: "/work" } as unknown as BgSession;

/** A slice over a bare state: each command answers as told (null: the host refuses). */
function slice(answer: BgList | null = LIST, started: { id: string } | null = { id: "new" }) {
  let state = initialBackgroundState();
  const calls: string[] = [];
  const shown: string[] = [];
  const core: BackgroundCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    list: async (host) => {
      calls.push(`list ${host}`);
      return answer;
    },
    stop: async (_host, id) => {
      calls.push(`stop ${id}`);
      return answer;
    },
    respawn: async (_host, id) => {
      calls.push(`respawn ${id}`);
      return answer;
    },
    message: async (_host, id, text) => {
      calls.push(`message ${id} ${text}`);
      return answer;
    },
    start: async () => started,
    openTerminal: async (_host, session) => (answer ? { terminalId: `t-${session.id}` } : null),
    showTerminal: (host, terminalId) => {
      shown.push(`${host}:${terminalId}`);
    },
  };
  return { background: new BackgroundSlice(core), state: () => state, calls, shown };
}

describe("background slice: a host's background sessions", () => {
  test("load keeps the list the host gave, and a refusal keeps nothing", async () => {
    const ok = slice();
    await ok.background.load("h1");
    expect(ok.state().background).toEqual({ h1: LIST });
    const refused = slice(null);
    await refused.background.load("h1");
    expect(refused.state().background).toEqual({});
  });

  test("stop, respawn and message each ask the host once and keep the list that comes back", async () => {
    const s = slice();
    expect(await s.background.act("h1", "stop", "s1")).toBe(true);
    expect(await s.background.act("h1", "respawn", "s1")).toBe(true);
    expect(await s.background.message("h1", "s1", "hi")).toBe(true);
    expect(s.calls).toEqual(["stop s1", "respawn s1", "message s1 hi"]);
    expect(s.state().background.h1).toBe(LIST);
    expect(await slice(null).background.act("h1", "stop", "s1")).toBe(false);
  });

  test("attach shows the terminal it opened, and nothing when the host refuses", async () => {
    const s = slice();
    expect(await s.background.attach("h1", SESSION)).toBe("t-s1");
    expect(s.shown).toEqual(["h1:t-s1"]);
    const refused = slice(null);
    expect(await refused.background.attach("h1", SESSION)).toBeNull();
    expect(refused.shown).toEqual([]);
  });

  test("start gives the new id and reads the list again; a refusal reads nothing", async () => {
    const s = slice();
    expect(await s.background.start("h1", { cardId: "c1" } as never)).toBe("new");
    expect(s.calls).toEqual(["list h1"]);
    const refused = slice(LIST, null);
    expect(await refused.background.start("h1", { cardId: "c1" } as never)).toBeNull();
    expect(refused.calls).toEqual([]);
  });

  test("changed gives the patch for a list that differs, nothing for the same one", async () => {
    const s = slice();
    expect(s.background.changed("h1", LIST)).toEqual({ background: { h1: LIST } });
    await s.background.load("h1");
    expect(s.background.changed("h1", structuredClone(LIST))).toBeNull();
  });

  test("two lists that arrive out of order for different hosts are both kept", async () => {
    const lists = { h1: { sessions: [{ id: "a" }] }, h2: { sessions: [{ id: "b" }] } };
    const waiting: Array<() => void> = [];
    let state = initialBackgroundState();
    const core = {
      state: () => state,
      update: (patch: Partial<typeof state>) => {
        state = { ...state, ...patch };
      },
      list: (host: "h1" | "h2") =>
        new Promise((resolve) => waiting.push(() => resolve(lists[host]))),
    } as unknown as BackgroundCore;
    const slice = new BackgroundSlice(core);
    const first = slice.load("h1");
    const second = slice.load("h2");
    waiting[1]?.();
    await second;
    waiting[0]?.();
    await first;
    expect(Object.keys(state.background)).toEqual(["h2", "h1"]);
  });
});
