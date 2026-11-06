import { describe, expect, test } from "bun:test";
import type { TreeNode } from "../src/lib/project-tree.ts";
import {
  loadTreeFolded,
  pickedIn,
  saveTreeFolded,
  TREE_CAP,
  TREE_FOLDED_KEY,
  visibleNodes,
} from "../src/lib/tree-fold.ts";

const storage = (value: string | null) => ({ getItem: () => value });
const node = (n: number): TreeNode => ({
  key: `k${n}`,
  kind: "worktree",
  branch: `b${n}`,
  base: "main",
  path: `/wt/${n}`,
  tone: "idle",
  cardId: null,
});

describe("arvore-projetos-dobra-lib: the fold of the sidebar tree (issue #215)", () => {
  test("what is stored is read with care: nothing, nonsense, a non-list, and a list with strangers", () => {
    expect(loadTreeFolded(storage(null))).toEqual([]);
    expect(loadTreeFolded(storage("{not json"))).toEqual([]);
    expect(loadTreeFolded(storage('{"a":1}'))).toEqual([]);
    expect(loadTreeFolded(storage('["h1/p", 3, null, "h2/q"]'))).toEqual(["h1/p", "h2/q"]);
  });

  test("a fold is written as a list under its own key", () => {
    const written: Array<[string, string]> = [];
    saveTreeFolded({ setItem: (k, v) => void written.push([k, v]) }, ["h1/p"]);
    expect(written).toEqual([[TREE_FOLDED_KEY, '["h1/p"]']]);
  });

  test("the cap is 8; a short list is whole; a long one keeps the first 8 and the picked one", () => {
    expect(TREE_CAP).toBe(8);
    const nodes = Array.from({ length: 12 }, (_, i) => node(i));
    expect(visibleNodes(nodes.slice(0, 8), false, () => false)).toHaveLength(8);
    expect(visibleNodes(nodes, false, () => false).map((n) => n.key)).toEqual(
      nodes.slice(0, 8).map((n) => n.key),
    );
    expect(visibleNodes(nodes, false, (n) => n.key === "k10")).toHaveLength(9);
    expect(visibleNodes(nodes, true, () => false)).toHaveLength(12);
  });

  test("a pick belongs to a project only when host and project match", () => {
    const filter = {
      hostId: "h1",
      projectId: "p",
      kind: "worktree" as const,
      path: "/x",
      branch: "b",
    };
    expect(pickedIn(filter, "h1", "p")).toBe(filter);
    expect(pickedIn(filter, "h2", "p")).toBeNull();
    expect(pickedIn(filter, "h1", "q")).toBeNull();
    expect(pickedIn(null, "h1", "p")).toBeNull();
  });
});
