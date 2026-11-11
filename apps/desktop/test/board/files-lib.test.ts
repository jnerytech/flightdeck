import { describe, expect, test } from "bun:test";
import { boardFiles, filesPanelOpen } from "../../src/lib/board-files.ts";

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

const SEARCH = ["file.list", "file.search"];

describe("board-files: what the files panel beside the board shows (#117)", () => {
  test("a picked worktree shows the files of the card that owns it; search comes with file.search", () => {
    expect([
      boardFiles(worktree, cards, ["file.list"]),
      boardFiles(worktree, cards, SEARCH),
    ]).toEqual([
      { kind: "tree", target: "card:B", branch: "fd/b", search: false },
      { kind: "tree", target: "card:B", branch: "fd/b", search: true },
    ]);
  });

  test("the main checkout is the project's own target on a host with file.search, else a hint", () => {
    expect([boardFiles(primary, cards, SEARCH), boardFiles(primary, cards, ["file.list"])]).toEqual(
      [
        { kind: "tree", target: "project:p1", branch: "main", search: true },
        { kind: "primary", branch: "main" },
      ],
    );
  });

  test("nothing picked, a worktree no card owns, or a host without file.list: no panel", () => {
    expect([
      boardFiles(null, cards, SEARCH),
      boardFiles({ ...worktree, path: "/wt/other" }, cards, SEARCH),
      boardFiles(worktree, cards, []),
      boardFiles(worktree, cards, undefined),
    ]).toEqual([null, null, null, null]);
  });
});

/** #1125: whether the files panel shows; the person's choice for this worktree beats the width. */
describe("filesPanelOpen: wide shows at once, narrow waits, the choice for this worktree wins", () => {
  const files = { kind: "primary", branch: "main" } as const;
  test("with no files it is closed; wide it is open; narrow it waits", () => {
    expect([
      filesPanelOpen(null, null, worktree, false),
      filesPanelOpen(files, null, worktree, false),
      filesPanelOpen(files, null, worktree, true),
    ]).toEqual([false, true, false]);
  });

  test("a choice for this worktree wins over the width; one for another worktree does not", () => {
    expect([
      filesPanelOpen(files, { path: "/wt/b", open: true }, worktree, true),
      filesPanelOpen(files, { path: "/wt/b", open: false }, worktree, false),
      filesPanelOpen(files, { path: "/wt/other", open: true }, worktree, true),
      filesPanelOpen(files, { path: "/wt/other", open: false }, worktree, false),
    ]).toEqual([true, false, false, true]);
  });
});
