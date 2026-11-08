import { describe, expect, test } from "bun:test";
import type { UsageSummary } from "@flightdeck/protocol";
import { HomeCache, homeHostData, homeKey } from "../src/lib/home-cache.ts";
import { homeKpis } from "../src/lib/home-kpis.ts";

const row = (projectKey: string, costUsd: number) => ({
  day: "2026-10-10",
  projectKey,
  costUsd,
  inputTokens: 1,
  outputTokens: 1,
  turns: 2,
});

// #126 slice 4: Home follows a project scope.
describe("home-cache: a project's numbers on Home", () => {
  test("a project has a cache entry of its own, apart from its hosts'", () => {
    const hosts = ["h2", "h1"];
    expect({
      hosts: homeKey("7d", hosts),
      project: homeKey("7d", hosts, "github.com/x/y"),
      same:
        homeKey("7d", ["h1", "h2"], "github.com/x/y") === homeKey("7d", hosts, "github.com/x/y"),
    }).toEqual({
      hosts: "7d|h1,h2",
      project: "7d|h1,h2|project:github.com/x/y",
      same: true,
    });
  });

  test("with a project, only its usage rows are kept", () => {
    const usage: UsageSummary = {
      days: 7,
      rows: [row("github.com/x/y", 2), row("github.com/x/z", 5)],
    };
    const all = homeHostData(null, usage, 1);
    const one = homeHostData(null, usage, 1, "github.com/x/z");
    expect({
      all: all.usage?.rows.map((r) => r.costUsd),
      one: one.usage?.rows.map((r) => r.costUsd),
    }).toEqual({ all: [2, 5], one: [5] });
  });
});

// Review of #917: a project's name never reaches the storage, and its budget is its own.
describe("home-cache: a project's numbers stay off the disk, and its budget is its own", () => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
  const snapshot = { h1: { at: 1, costs: null, usage: null } };

  test("a project entry is kept in memory only; a host entry is written", () => {
    const cache = new HomeCache(storage);
    cache.set(homeKey("7d", ["h1"]), snapshot);
    cache.set(homeKey("7d", ["h1"], "host:alfa:/work/secret"), snapshot);
    const written = items.get("flightdeck.home.v1") ?? "";
    expect({
      host: written.includes("7d|h1"),
      project: written.includes("secret"),
      memory: cache.get(homeKey("7d", ["h1"], "host:alfa:/work/secret")) !== undefined,
    }).toEqual({ host: true, project: false, memory: true });
  });

  test("in a project scope the month's budget is that project's, not its hosts'", () => {
    const budget = (scope: "host" | "project", projectKey: string | null, limitUsd: number) => ({
      id: `${scope}-${limitUsd}`,
      scope,
      projectKey,
      period: "month" as const,
      limitUsd,
      action: "notify" as const,
      createdAt: "2026-10-01",
      periodKey: "2026-10",
      spentUsd: 1,
      fraction: 1 / limitUsd,
      limitPct: null,
      spentPct: null,
      estimated: false,
      crossed: [],
    });
    const budgets = [budget("host", null, 100), budget("project", "github.com/x/z", 10)];
    const input = { days: ["2026-10-10"], costs: [], usage: [], budgets };
    expect({
      hosts: homeKpis(input).spend.budget?.limitUsd,
      project: homeKpis({ ...input, projectKey: "github.com/x/z" }).spend.budget?.limitUsd,
      other: homeKpis({ ...input, projectKey: "github.com/x/y" }).spend.budget,
    }).toEqual({ hosts: 100, project: 10, other: null });
  });
});
