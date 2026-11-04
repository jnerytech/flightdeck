import { describe, expect, test } from "bun:test";
import type { Card, Project } from "@flightdeck/protocol";
import type { HubRow } from "../src/lib/hub.ts";
import {
  cardInFilter,
  projectTree,
  rowInFilter,
  type WorktreeFilter,
} from "../src/lib/project-tree.ts";

const project = (id: string, name: string, over: Partial<Project> = {}): Project =>
  ({ id, name, path: `/work/${name}`, baseBranch: "main", ...over }) as Project;

const card = (id: string, over: Partial<Card> = {}): Card =>
  ({
    id,
    projectId: "p-api",
    title: id,
    branch: null,
    worktreePath: null,
    sessionStatus: null,
    position: 0,
    createdAt: "2026-11-01T10:00:00Z",
    ...over,
  }) as Card;

const row = (over: Partial<HubRow>): HubRow =>
  ({
    key: "k",
    hostId: "h1",
    cwd: "/work/api",
    state: "idle",
    origin: "terminal",
    archived: false,
    ...over,
  }) as HubRow;

const state = (cards: Card[]) =>
  ({
    hosts: [{ id: "h1", name: "alfa", status: "online" }],
    projects: { h1: [project("p-api", "api", { baseBranch: "develop" }), project("p-web", "web")] },
    cards: Object.fromEntries(cards.map((c) => [`h1/${c.id}`, c])),
  }) as never;

describe("arvore-projetos: the sidebar tree of a project (issue #116)", () => {
  test("each project has its primary checkout first, then one node per card with a worktree", () => {
    const tree = projectTree(
      state([
        card("c2", { branch: "fd/b", worktreePath: "/wt/b", sessionStatus: "running" }),
        card("c1", { branch: "fd/a", worktreePath: "/wt/a", sessionStatus: "awaiting_permission" }),
        card("c3", { title: "no worktree yet" }),
        card("c4", { projectId: "p-web", branch: "fd/w", worktreePath: "/wt/w" }),
      ]),
      [],
    );
    const api = tree.find((p) => p.projectId === "p-api");
    expect(api?.nodes.map((n) => [n.kind, n.branch, n.base, n.path, n.tone])).toEqual([
      ["primary", "develop", "develop", "/work/api", "idle"],
      ["worktree", "fd/a", "develop", "/wt/a", "needs-you"],
      ["worktree", "fd/b", "develop", "/wt/b", "running"],
    ]);
    expect(tree.find((p) => p.projectId === "p-web")?.nodes.map((n) => n.branch)).toEqual([
      "main",
      "fd/w",
    ]);
    expect(tree.map((p) => p.name)).toEqual(["api", "web"]);
  });

  test("the primary node takes the tone of the live sessions in the project's own folder", () => {
    const live = (state_: HubRow["state"], cwd: string) => row({ state: state_, cwd });
    const tone = (rows: HubRow[]) =>
      projectTree(state([]), rows).find((p) => p.projectId === "p-api")?.nodes[0]?.tone;
    expect(tone([live("running", "/work/api"), live("needs_you", "/work/api/sub")])).toBe(
      "needs-you",
    );
    expect(tone([live("running", "/work/api")])).toBe("running");
    expect(tone([live("running", "/work/other")])).toBe("idle");
    expect(tone([live("ended", "/work/api")])).toBe("idle");
  });

  test("a project of an offline host, or whose projects have not loaded, has no tree", () => {
    const base = state([]) as { hosts: Array<{ status: string }> };
    expect(
      projectTree({ ...base, hosts: [{ id: "h1", name: "alfa", status: "offline" }] } as never, []),
    ).toEqual([]);
    expect(projectTree({ ...base, projects: {} } as never, [])).toEqual([]);
  });
});

describe("arvore-projetos: what a node keeps (issue #116)", () => {
  const primary: WorktreeFilter = {
    hostId: "h1",
    projectId: "p-api",
    kind: "primary",
    path: "/work/api",
    branch: "develop",
  };
  const worktree: WorktreeFilter = { ...primary, kind: "worktree", path: "/wt/a", branch: "fd/a" };

  test("a worktree keeps its card; the primary keeps the cards with no worktree", () => {
    expect(cardInFilter(card("c1", { worktreePath: "/wt/a" }), worktree)).toBe(true);
    expect(cardInFilter(card("c2", { worktreePath: "/wt/b" }), worktree)).toBe(false);
    expect(cardInFilter(card("c3"), worktree)).toBe(false);
    expect(cardInFilter(card("c3"), primary)).toBe(true);
    expect(cardInFilter(card("c1", { worktreePath: "/wt/a" }), primary)).toBe(false);
  });

  test("a worktree keeps the sessions inside it; the primary keeps the ones in the project's folder outside every worktree", () => {
    const p = { path: "/work/api" };
    const wts = ["/wt/a", "/work/api/.wt/b"];
    expect(rowInFilter(row({ cwd: "/wt/a/src" }), worktree, p, wts)).toBe(true);
    expect(rowInFilter(row({ cwd: "/work/api" }), worktree, p, wts)).toBe(false);
    expect(rowInFilter(row({ cwd: "/work/api/src" }), primary, p, wts)).toBe(true);
    expect(rowInFilter(row({ cwd: "/work/api/.wt/b/x" }), primary, p, wts)).toBe(false);
    expect(rowInFilter(row({ cwd: "/work/other" }), primary, p, wts)).toBe(false);
    expect(rowInFilter(row({ hostId: "h2", cwd: "/work/api" }), primary, p, wts)).toBe(false);
  });
});
