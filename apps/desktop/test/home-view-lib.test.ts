import { describe, expect, test } from "bun:test";
import type { CostsSummary } from "@flightdeck/protocol";
import type { T } from "../src/i18n/index.ts";
import { emptySummary } from "../src/lib/client-costs.ts";
import type { HomeHostData } from "../src/lib/home-cache.ts";
import {
  addUp,
  type HostRead,
  homeMessage,
  keepAnswers,
  rangeSubtitle,
} from "../src/lib/home-view.ts";

/** Issue #363 (Sonar S3776): what Home worked out inside the page is worked out here, with its answers pinned. */
const t = Object.assign(
  (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(",")}` : key,
  { lang: "en" as const },
) as unknown as T;

const range = { from: "2026-11-01", to: "2026-11-07" };
const week = (...projects: Array<[string, number]>): CostsSummary => ({
  ...emptySummary(range.from, range.to),
  byProject: projects.map(([projectKey, tokens]) => ({ projectKey, tokens, costUsd: 1 })),
});
const data = (at: number): HomeHostData => ({ at, costs: null, usage: null });
const read = (id: string, over: Partial<HostRead> = {}): HostRead => ({
  id,
  priced: true,
  answered: true,
  data: data(1),
  shares: { week: week(["p", 10]), first: week(["p", 5]), second: week(["p", 5]) },
  ...over,
});

describe("home-view: the subtitle says whose numbers they are", () => {
  test.each([
    [{ kind: "all" }, undefined, undefined, "home.range"],
    [{ kind: "project", projectKey: "k" }, undefined, "Shown", "home.rangeProject:Shown"],
    [{ kind: "project", projectKey: "/a/b/k" }, undefined, undefined, "home.rangeProject:k"],
    [{ kind: "host", hostId: "h" }, "Pi", undefined, "home.rangeHost:Pi"],
    [{ kind: "host", hostId: "h" }, undefined, undefined, "home.rangeDays"],
  ] as const)("scope %j, host %j, project %j gives %j", (scope, host, project, expected) => {
    expect(rangeSubtitle(t, scope, host, project)).toBe(expected);
  });
});

describe("home-view: the line of the live region until the numbers come", () => {
  const base = { ready: false, away: undefined, connecting: false, online: 1 };
  test.each([
    [{ ...base, ready: true, online: 0 }, "home.ready"],
    [{ ...base, away: { status: "offline", name: "Pi" } }, "scope.offline:Pi"],
    [{ ...base, away: { status: "incompatible", name: "Pi" } }, "scope.incompatible:Pi"],
    [{ ...base, away: { status: "offline", name: "Pi" }, connecting: true }, "home.loading"],
    [{ ...base, online: 0, connecting: true }, "home.connecting"],
    [{ ...base, online: 0 }, "home.noHosts"],
    [base, "home.loading"],
  ] as const)("%j says %j", (state, expected) => {
    expect(homeMessage(t, state as Parameters<typeof homeMessage>[1])).toBe(expected);
  });
});

describe("home-view: a host that did not answer keeps its numbers", () => {
  test("an answer replaces; a silence keeps the old; a silence with none stores what came; offline hosts stay", () => {
    const before = { a: data(1), b: data(2), off: data(3) };
    const reads = [
      read("a", { data: data(10) }),
      read("b", { answered: false, data: data(20) }),
      read("c", { answered: false, data: data(30) }),
    ];
    expect(keepAnswers(before, reads)).toEqual({
      a: data(10),
      b: data(2),
      c: data(30),
      off: data(3),
    });
    expect(before.a).toEqual(data(1));
  });
});

describe("home-view: the reads added up into the week's projects and the leaderboard", () => {
  test("every host with costs gave its three: the leaderboard is whole, the projects are named", () => {
    const total = addUp(
      [
        read("a", {
          shares: { week: week(["x", 30]), first: week(["x", 10]), second: week(["x", 20]) },
        }),
        read("b", {
          shares: { week: week(["y", 70]), first: week(["y", 30]), second: week(["y", 40]) },
        }),
      ],
      range,
    );
    expect(total.whole).toBe(true);
    expect([...(total.projectKeys ?? [])].sort()).toEqual(["x", "y"]);
    expect(total.leaders?.project.map((r) => [r.key, r.tokens])).toEqual([
      ["y", 70],
      ["x", 30],
    ]);
  });

  test("a host with costs that gave none of its three makes the leaderboard partial, not wrong", () => {
    const total = addUp([read("a"), read("b", { shares: null, answered: false })], range);
    expect(total.whole).toBe(false);
    expect(total.leaders).toBeNull();
    expect(total.projectKeys).toEqual(["p"]);
  });

  test("hosts without costs add nothing: no projects to note and no leaderboard", () => {
    const total = addUp([read("a", { priced: false, shares: null })], range);
    expect(total).toEqual({ projectKeys: null, whole: false, leaders: null });
    expect(addUp([], range)).toEqual({ projectKeys: null, whole: false, leaders: null });
  });
});
