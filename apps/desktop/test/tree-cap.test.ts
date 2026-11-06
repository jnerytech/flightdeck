import { describe, expect, test } from "bun:test";
import type { HubRow } from "../src/lib/hub.ts";
import { projectTree, type TreeProject } from "../src/lib/project-tree.ts";
import {
  FOLD_ABOVE,
  foldedByDefault,
  liveTone,
  loadTreeOpened,
  loadTreePinned,
  PROJECT_CAP,
  projectKey,
  saveTreeOpened,
  saveTreePinned,
  shownProjects,
  TREE_OPENED_KEY,
  TREE_PINNED_KEY,
} from "../src/lib/tree-fold.ts";

const project = (name: string, lastActivityAt = 0, host = "h1"): TreeProject => ({
  hostId: host,
  projectId: `p-${name}`,
  name,
  path: `/work/${name}`,
  lastActivityAt,
  nodes: [
    {
      key: `${host}/p-${name}/primary`,
      kind: "primary",
      branch: "main",
      base: "main",
      path: `/work/${name}`,
      tone: "idle",
      cardId: null,
    },
  ],
});
const names = (list: TreeProject[]) => list.map((p) => p.name);
/** Eight projects, `a` the oldest and `h` the newest. */
const EIGHT = "abcdefgh".split("").map((name, i) => project(name, (i + 1) * 1000));

describe("tree-cap: how many projects the sidebar tree draws (issue #689)", () => {
  test("the numbers: five projects, folding starts above three", () => {
    expect([PROJECT_CAP, FOLD_ABOVE]).toEqual([5, 3]);
  });

  test("past five, the most recently active five, newest first", () => {
    expect(names(shownProjects(EIGHT, [], "", null))).toEqual(["h", "g", "f", "e", "d"]);
  });

  test("five or fewer are all shown, and two with no activity go by name", () => {
    const quiet = [project("zeta"), project("alfa"), project("mid")];
    expect(names(shownProjects(quiet, [], "", null))).toEqual(["alfa", "mid", "zeta"]);
    expect(shownProjects(EIGHT.slice(0, 5), [], "", null)).toHaveLength(5);
  });

  test("the pinned come first, then the recent ones fill up to five", () => {
    const pinned = [projectKey(EIGHT[0] as TreeProject), projectKey(EIGHT[2] as TreeProject)];
    expect(names(shownProjects(EIGHT, pinned, "", null))).toEqual(["c", "a", "h", "g", "f"]);
  });

  test("more than five pinned: only the pinned five newest are shown, the rest wait in All projects", () => {
    const pinned = EIGHT.slice(0, 6).map(projectKey);
    expect(names(shownProjects(EIGHT, pinned, "", null))).toEqual(["f", "e", "d", "c", "b"]);
  });

  test("the picked project is always in, after the five", () => {
    const picked = projectKey(EIGHT[0] as TreeProject);
    expect(names(shownProjects(EIGHT, [], "", picked))).toEqual(["h", "g", "f", "e", "d", "a"]);
    const inside = projectKey(EIGHT[7] as TreeProject);
    expect(names(shownProjects(EIGHT, [], "", inside))).toEqual(["h", "g", "f", "e", "d"]);
  });

  test("a name typed shows every match, ignoring case, pinned first", () => {
    const tree = ["Api-one", "web", "api-two", "docs", "API-three", "apix", "tools"].map(
      (name, i) => project(name, i * 10),
    );
    const found = shownProjects(tree, [projectKey(tree[0] as TreeProject)], "  API ", null);
    expect(names(found)).toEqual(["Api-one", "apix", "API-three", "api-two"]);
    expect(shownProjects(tree, [], "nothing like it", null)).toEqual([]);
  });

  test("two hosts with a project of the same name are two projects", () => {
    const both = [project("api", 5, "h1"), project("api", 9, "h2")];
    expect(shownProjects(both, [], "", null).map((p) => p.hostId)).toEqual(["h2", "h1"]);
  });
});

describe("tree-cap: the fold at the start and the dot of a folded project (issue #689)", () => {
  test("with three projects or fewer nothing starts folded", () => {
    expect([1, 2, 3].map((n) => foldedByDefault(n, "h1/p-x", null))).toEqual([false, false, false]);
  });

  test("with more, all but the active project start folded", () => {
    expect(foldedByDefault(4, "h1/p-x", "h1/p-y")).toBe(true);
    expect(foldedByDefault(4, "h1/p-y", "h1/p-y")).toBe(false);
    expect(foldedByDefault(25, "h1/p-x", null)).toBe(true);
  });

  test("a folded project is marked by a needs-you first, then by a running session, else not", () => {
    const withTones = (...tones: Array<"idle" | "running" | "needs-you">): TreeProject => {
      const base = project("api");
      const [first] = base.nodes;
      return {
        ...base,
        nodes: tones.map((tone, i) => ({
          ...(first as TreeProject["nodes"][number]),
          key: `k${i}`,
          tone,
        })),
      };
    };
    expect(liveTone(withTones("idle", "idle"))).toBeNull();
    expect(liveTone(withTones("idle", "running"))).toBe("running");
    expect(liveTone(withTones("running", "needs-you", "idle"))).toBe("needs-you");
  });
});

describe("tree-cap: what the tree remembers (issue #689)", () => {
  const storage = (value: string | null) => ({ getItem: () => value });

  test("the pinned and the unfolded are read with care", () => {
    expect([loadTreePinned(storage(null)), loadTreeOpened(storage(null))]).toEqual([[], []]);
    expect(loadTreePinned(storage("{nope"))).toEqual([]);
    expect(loadTreeOpened(storage('["h1/p", 3, null]'))).toEqual(["h1/p"]);
  });

  test("they are saved under their own keys", () => {
    const saved: Record<string, string> = {};
    const put = {
      setItem: (key: string, value: string) => {
        saved[key] = value;
      },
    };
    saveTreePinned(put, ["h1/p"]);
    saveTreeOpened(put, ["h2/q"]);
    expect(saved).toEqual({
      [TREE_PINNED_KEY]: '["h1/p"]',
      [TREE_OPENED_KEY]: '["h2/q"]',
    });
  });
});

describe("tree-cap: a project knows when it last changed (issue #689)", () => {
  const row = (cwd: string, lastActivity: string, hostId = "h1"): HubRow =>
    ({ hostId, cwd, lastActivity, archived: false, state: "idle" }) as unknown as HubRow;

  test("it is the newest session inside its folder, on its host; none is 0", () => {
    const state = {
      hosts: [{ id: "h1", status: "online" }],
      projects: {
        h1: [
          { id: "p-api", name: "api", path: "/work/api", baseBranch: "main" },
          { id: "p-web", name: "web", path: "/work/web", baseBranch: "main" },
        ],
      },
      cards: {},
    } as never;
    const rows = [
      row("/work/api", "2026-11-06T10:00:00Z"),
      row("/work/api/src", "2026-11-06T12:00:00Z"),
      row("/work/api", "2026-11-06T13:00:00Z", "h2"),
    ];
    expect(projectTree(state, rows).map((p) => p.lastActivityAt)).toEqual([
      Date.parse("2026-11-06T12:00:00Z"),
      0,
    ]);
  });
});
