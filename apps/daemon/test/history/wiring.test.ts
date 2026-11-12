import { describe, expect, test } from "bun:test";
import { createHistory } from "../../src/history/wiring.ts";
import type { Names } from "../../src/names/index.ts";
import { historyExcludes } from "../../src/permissions/index.ts";
import { EventStore } from "../../src/store/event-store.ts";

/**
 * The history index as main.ts builds it (#1593): the config's roots, exclusions and scan
 * interval, and a title Claude Code gives a session adopted under the name Flightdeck knows it by.
 */
const config = {
  dataDir: "/data",
  history: { roots: ["/home/dev/.claude/projects"], excludeCwds: ["/skip"], scanIntervalMs: 0 },
};

function built(scanIntervalMs = 0) {
  const adopted: unknown[][] = [];
  const names = { adoptTitle: (...args: unknown[]) => adopted.push(args) } as unknown as Names;
  const manager = { list: () => [{ id: "fd-1", claudeSessionId: "c-1" }] };
  const store = new EventStore(":memory:");
  const history = createHistory({
    db: store.db,
    config: { ...config, history: { ...config.history, scanIntervalMs } },
    names,
    manager: manager as never,
    log: () => {},
  });
  return { history, adopted, store };
}

describe("history-wiring: the index of the recorded conversations (#1593)", () => {
  test("the roots and the exclusions come from the config, the same the costs skip", () => {
    const { history, store } = built();
    try {
      expect([
        history.opts.roots,
        history.opts.excludeCwds?.includes("/skip"),
        history.opts.excludeCwds,
      ]).toEqual([config.history.roots, true, historyExcludes(config)]);
    } finally {
      store.close();
    }
  });

  test("a zero scan interval keeps the index's own; another is passed on", () => {
    const zero = built(0);
    const set = built(500);
    try {
      expect([zero.history.opts.scanIntervalMs, set.history.opts.scanIntervalMs]).toEqual([
        undefined,
        500,
      ]);
    } finally {
      zero.store.close();
      set.store.close();
    }
  });

  test("a title reaches the managed session's name, or the conversation's own id", () => {
    const { history, adopted, store } = built();
    try {
      history.opts.onTitle?.("c-1", "Fix the login", "custom");
      history.opts.onTitle?.("c-2", "Elsewhere", "agent");
      expect(adopted).toEqual([
        ["fd-1", "Fix the login", "custom"],
        ["c-2", "Elsewhere", "agent"],
      ]);
    } finally {
      store.close();
    }
  });
});
