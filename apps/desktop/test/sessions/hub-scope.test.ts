import { describe, expect, test } from "bun:test";
import {
  awayHost,
  hubProjectKeys,
  projectChoices,
  type RowNarrowing,
  rowsInScope,
  scopeKeys,
} from "../../src/features/sessions/hub-scope.ts";

const row = (hostId: string, projectKey: string, cwd = "/work/app") => ({
  hostId,
  projectKey,
  cwd,
});

const none: RowNarrowing = {
  host: "",
  project: "",
  only: null,
  picked: null,
  pickedProject: undefined,
  worktrees: [],
};

describe("scopeKeys", () => {
  test("a host scope pins its host, a project scope its project, all pins neither", () => {
    expect(scopeKeys({ kind: "host", hostId: "h1" })).toEqual({ host: "h1", project: "" });
    expect(scopeKeys({ kind: "project", projectKey: "p1" })).toEqual({ host: "", project: "p1" });
    expect(scopeKeys({ kind: "all" })).toEqual({ host: "", project: "" });
  });
});

describe("awayHost", () => {
  const hosts = [
    { id: "a", status: "offline" },
    { id: "b", status: "online" },
    { id: "c", status: "connecting" },
    { id: "d", status: "unauthorized" },
  ];

  test("the scoped host is away when it is neither online nor connecting", () => {
    expect(awayHost(hosts, { kind: "host", hostId: "a" })).toBe(hosts[0]);
    expect(awayHost(hosts, { kind: "host", hostId: "d" })).toBe(hosts[3]);
  });

  test("an online or connecting scoped host is not away", () => {
    expect(awayHost(hosts, { kind: "host", hostId: "b" })).toBeUndefined();
    expect(awayHost(hosts, { kind: "host", hostId: "c" })).toBeUndefined();
  });

  test("only a host scope can be away: all and a project say nothing about one host", () => {
    expect(awayHost(hosts, { kind: "all" })).toBeUndefined();
    expect(awayHost(hosts, { kind: "project", projectKey: "p" })).toBeUndefined();
  });
});

describe("rowsInScope", () => {
  const a1 = row("a", "p1");
  const a2 = row("a", "p2");
  const b1 = row("b", "p1");
  const rows = [a1, a2, b1];

  test("no narrowing keeps every row", () => {
    expect(rowsInScope(rows, none)).toEqual(rows);
  });

  test("the scoped host and the scoped project each keep only theirs", () => {
    expect(rowsInScope(rows, { ...none, host: "a" })).toEqual([a1, a2]);
    expect(rowsInScope(rows, { ...none, project: "p1" })).toEqual([a1, b1]);
  });

  test("the project asked by the route keeps its host and its key together", () => {
    expect(rowsInScope(rows, { ...none, only: { hostId: "b", projectKey: "p1" } })).toEqual([b1]);
  });

  test("the checkout picked in the sidebar keeps the sessions inside it", () => {
    const inWt = row("a", "p1", "/work/app/wt1/src");
    const inside = [inWt, row("a", "p1", "/work/app/src")];
    const picked = {
      hostId: "a",
      projectId: "p1",
      kind: "worktree" as const,
      path: "/work/app/wt1",
      branch: "wt1",
    };
    expect(
      rowsInScope(inside, { ...none, picked, pickedProject: { path: "/work/app" }, worktrees: [] }),
    ).toEqual([inWt]);
  });

  test("a picked checkout with no project to read leaves the rows alone", () => {
    const picked = {
      hostId: "a",
      projectId: "p1",
      kind: "primary" as const,
      path: "/work/app",
      branch: "main",
    };
    expect(rowsInScope(rows, { ...none, picked })).toEqual(rows);
  });
});

describe("hubProjectKeys", () => {
  test("each key once, the scoped one included, none empty", () => {
    const rows = [
      { projectKey: "b" },
      { projectKey: "a" },
      { projectKey: "b" },
      { projectKey: "" },
    ];
    expect(hubProjectKeys(rows, "c")).toEqual(["b", "a", "c"]);
  });

  test("with no rows and no scoped project there is nothing to offer", () => {
    expect(hubProjectKeys([], "")).toEqual([]);
  });
});

describe("projectChoices", () => {
  test("sorted by label, a named key shows its name", () => {
    const names = new Map([["k2", "Alpha"]]);
    const labels = projectChoices(["k1", "k2"], names).map((c) => c.label);
    expect(labels[0]).toBe("Alpha");
    expect(labels).toHaveLength(2);
  });

  test("a key with no name reads as its own label", () => {
    const [choice] = projectChoices(["/home/me/zeta"], new Map());
    expect(choice?.key).toBe("/home/me/zeta");
    expect(choice?.label).toBe("zeta");
  });
});
