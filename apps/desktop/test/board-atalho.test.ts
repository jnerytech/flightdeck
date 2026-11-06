import { describe, expect, test } from "bun:test";
import { boardShortcut, loadLastBoards, saveLastBoard } from "../src/lib/board-shortcut.ts";

const memory = (seed: Record<string, string> = {}) => {
  const items = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

const pick = (hostId: string, projectId: string) => ({
  hostId,
  projectId,
  kind: "worktree" as const,
  path: `/w/${projectId}-wt`,
  branch: "fd/x",
});

// Issue #669: the sidebar's Board item opens a board directly when the app knows which one: the
// worktree picked in the project tree, the only project, or the board last opened on that host.
describe("board-atalho: which board the Board item opens", () => {
  test("the worktree picked on this host wins, then the only project, then the last board", () => {
    const projectIds = ["p1", "p2", "p3"];
    expect([
      boardShortcut({ hostId: "h1", projectIds, worktree: pick("h1", "p2"), remembered: "p3" }),
      boardShortcut({ hostId: "h1", projectIds: ["p9"], worktree: null, remembered: "p3" }),
      boardShortcut({ hostId: "h1", projectIds, worktree: null, remembered: "p3" }),
    ]).toEqual(["p2", "p9", "p3"]);
  });

  test("a pick on another host, or a remembered board that is gone, opens the landing", () => {
    const projectIds = ["p1", "p2"];
    expect([
      boardShortcut({ hostId: "h1", projectIds, worktree: pick("h2", "p1"), remembered: null }),
      boardShortcut({ hostId: "h1", projectIds, worktree: null, remembered: "gone" }),
      boardShortcut({ hostId: "h1", projectIds: [], worktree: null, remembered: null }),
    ]).toEqual([null, null, null]);
  });

  test("the last board is kept per host, and a broken store reads as nothing kept", () => {
    const storage = memory();
    saveLastBoard(storage, "h1", "p1");
    saveLastBoard(storage, "h2", "p7");
    saveLastBoard(storage, "h1", "p2");
    expect({
      kept: loadLastBoards(storage),
      broken: loadLastBoards(memory({ "flightdeck.lastBoards": "{not json" })),
      wrong: loadLastBoards(memory({ "flightdeck.lastBoards": '["p1"]' })),
    }).toEqual({ kept: { h1: "p2", h2: "p7" }, broken: {}, wrong: {} });
  });
});
