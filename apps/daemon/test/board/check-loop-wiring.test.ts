import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import type { Card, PermissionMode } from "@flightdeck/protocol";
import { createCheckLoop } from "../../src/board/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { readWatchSettings, type WatchSettings } from "../../src/watch/settings.ts";

/**
 * The check loop as main.ts builds it (issue #1593): the board reads the settings from the
 * database, the switch reads the watcher's, and both ask the project's trust.
 */

const stores: EventStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

function setup(opts: { trusted?: boolean; mode?: PermissionMode; watched?: string[] } = {}) {
  const store = new EventStore(":memory:");
  stores.push(store);
  const defaults = readWatchSettings(store.db, "none");
  const read: Array<[Database, string]> = [];
  const asked: string[] = [];
  const runner = { run: async () => ({ ok: true }) } as never;
  const checkLoop = createCheckLoop({
    db: store.db,
    trust: {
      isTrustedFolder: (path) => {
        asked.push(path);
        return opts.trusted ?? true;
      },
    },
    readSettings: (db, projectId) => {
      read.push([db, projectId]);
      return { ...defaults, checks: ["from-db"] };
    },
    runner,
  });
  const stored: unknown[] = [];
  const card = {
    id: "c1",
    projectId: "p1",
    sessionId: "s1",
    sessionStatus: "running",
    variant: null,
    checkLoop: null,
  } as unknown as Card;
  const board = {
    getCard: () => card,
    getProject: () => ({ path: "/w/p1" }),
    storeCheckLoop: (_id: string, loop: unknown) => {
      stored.push(loop);
      return card;
    },
  } as never;
  const watcher = {
    settings: (): WatchSettings => ({ ...defaults, checks: opts.watched ?? ["bun test"] }),
  };
  const manager = {
    modeOf: (id: string | null) =>
      (id === "s1" ? (opts.mode ?? "bypassPermissions") : "default") as PermissionMode,
  };
  const loopSwitch = checkLoop.switchOf({ board, watcher, manager });
  return { checkLoop, store, read, asked, runner, stored, loopSwitch };
}

const refusal = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
};

describe("check-loop-wiring: the check loop the daemon builds (#1593)", () => {
  test("the board's part reads the database's settings, the project's trust and the runner given", () => {
    const { checkLoop, store, read, asked, runner } = setup({ trusted: false });
    expect(checkLoop.board.settings("p1").checks).toEqual(["from-db"]);
    expect(read).toEqual([[store.db, "p1"]]);
    expect(checkLoop.board.isTrusted("/w/p1")).toBe(false);
    expect(asked).toEqual(["/w/p1"]);
    expect(checkLoop.board.runner).toBe(runner);
  });

  test("the switch turns on with the watcher's checks in the session's mode", () => {
    const { loopSwitch, stored, read } = setup();
    loopSwitch.set("c1", { on: true });
    expect(stored.map((loop) => (loop as { on: boolean }).on)).toEqual([true]);
    expect(read).toEqual([]);
  });

  test("the switch refuses a project the watcher has no checks for", () => {
    const { loopSwitch } = setup({ watched: [] });
    expect(refusal(() => loopSwitch.set("c1", { on: true }))).toBe("check_loop_no_checks");
  });

  test("the switch refuses an untrusted project and a session in plan mode", () => {
    const untrusted = setup({ trusted: false });
    expect(refusal(() => untrusted.loopSwitch.set("c1", { on: true }))).toBe(
      "check_loop_untrusted",
    );
    expect(untrusted.asked).toEqual(["/w/p1"]);
    const plan = setup({ mode: "plan" });
    expect(refusal(() => plan.loopSwitch.set("c1", { on: true }))).toBe("check_loop_mode");
  });
});
