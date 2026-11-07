import { describe, expect, test } from "bun:test";
import { boardFiles } from "../src/lib/board-files.ts";

const worktree = {
  hostId: "h1",
  projectId: "p1",
  kind: "worktree",
  path: "/wt/b",
  branch: "fd/b",
} as const;
const primary = {
  hostId: "h1",
  projectId: "p1",
  kind: "primary",
  path: "/x/api",
  branch: "main",
} as const;
const cards = [
  { id: "A", worktreePath: null },
  { id: "B", worktreePath: "/wt/b" },
  { id: "C", worktreePath: "/wt/b" },
];

describe("board-files: what the files panel beside the board shows (#117)", () => {
  test("a picked worktree shows the files of the card that owns it", () => {
    expect(boardFiles(worktree, cards, ["file.list"])).toEqual({
      kind: "worktree",
      target: "card:B",
      branch: "fd/b",
    });
  });

  test("the main checkout has no target yet: the panel says to pick a worktree", () => {
    expect(boardFiles(primary, cards, ["file.list"])).toEqual({ kind: "primary", branch: "main" });
  });

  test("nothing picked, a worktree no card owns, or a host without file.list: no panel", () => {
    expect([
      boardFiles(null, cards, ["file.list"]),
      boardFiles({ ...worktree, path: "/wt/other" }, cards, ["file.list"]),
      boardFiles(worktree, cards, []),
      boardFiles(worktree, cards, undefined),
    ]).toEqual([null, null, null, null]);
  });
});
