import { describe, expect, test } from "bun:test";
import type { UsageSummary } from "@flightdeck/protocol";
import { homeHostData, homeKey } from "../src/lib/home-cache.ts";

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
