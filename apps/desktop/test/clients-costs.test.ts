import { describe, expect, test } from "bun:test";
import type { CostsFilter, CostsSummary } from "@flightdeck/protocol";
import {
  costByClient,
  emptySummary,
  type HostSummary,
  loadCostsSummary,
  mergeSummaries,
} from "../src/lib/client-costs.ts";
import { ALL_CLIENTS, ClientScope } from "../src/lib/client-scope.ts";
import { type Client, UNASSIGNED } from "../src/lib/clients.ts";

const DAY = { from: "2026-10-10", to: "2026-10-12" };
const tokens = (input: number) => ({
  input,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
});

/** A summary from rows of `[day, projectKey, cost]`, one model, one origin. */
function summary(rows: Array<[string, string, number]>, extra: Partial<CostsSummary> = {}) {
  const byProject = new Map<string, number>();
  for (const [, key, cost] of rows) byProject.set(key, (byProject.get(key) ?? 0) + cost);
  const total = rows.reduce((sum, [, , cost]) => sum + cost, 0);
  return {
    ...emptySummary(DAY.from, DAY.to),
    totals: {
      costUsd: total,
      tokens: tokens(total * 1000),
      cacheSavingsUsd: total / 10,
      messages: rows.length,
      unpricedMessages: 0,
    },
    byDay: rows.map(([day, projectKey, costUsd]) => ({
      day,
      projectKey,
      costUsd,
      tokens: costUsd * 1000,
    })),
    byProject: [...byProject].map(([projectKey, costUsd]) => ({
      projectKey,
      costUsd,
      tokens: costUsd * 1000,
    })),
    byModel: [{ model: "opus", costUsd: total, tokens: total * 1000, priced: true }],
    byOrigin: [{ origin: "terminal" as const, costUsd: total, tokens: total * 1000 }],
    byPersona: [{ persona: null, costUsd: total, tokens: total * 1000 }],
    ...extra,
  } satisfies CostsSummary;
}

const client = (id: string, pattern: string): Client => ({
  id,
  name: id.toUpperCase(),
  color: "indigo",
  rules: [{ id: `r-${id}`, kind: "remote", pattern }],
  defaults: { vaultScope: false },
});
const scope = new ClientScope(
  {
    clients: [client("acme", "github.com/acme/*"), client("beta", "github.com/beta/*")],
    overrides: {},
  },
  [],
);
const ACME = "github.com/acme/api";
const ACME2 = "github.com/acme/web";
const BETA = "github.com/beta/app";
const OTHER = "github.com/other/x";

describe("clients-costs: several hosts as one", () => {
  const a: HostSummary = {
    hostId: "a",
    summary: summary(
      [
        ["2026-10-10", ACME, 2],
        ["2026-10-11", OTHER, 1],
      ],
      {
        topSessions: [
          {
            claudeSessionId: "s1",
            sessionId: null,
            projectKey: ACME,
            title: "t1",
            cwd: null,
            costUsd: 2,
            tokens: 2000,
          },
        ],
      },
    ),
  };
  const b: HostSummary = {
    hostId: "b",
    summary: summary(
      [
        ["2026-10-10", ACME, 1],
        ["2026-10-10", BETA, 3],
      ],
      {
        topSessions: [
          {
            claudeSessionId: "s2",
            sessionId: "m2",
            projectKey: BETA,
            title: "t2",
            cwd: null,
            costUsd: 3,
            tokens: 3000,
          },
        ],
      },
    ),
  };

  test("totals add up, and the same project on two hosts is one row, the costliest first and then by key", () => {
    const { summary: merged } = mergeSummaries([a, b], DAY.from, DAY.to);
    expect(merged.totals.costUsd).toBe(7);
    expect(merged.totals.tokens.input).toBe(7000);
    expect(merged.totals.cacheSavingsUsd).toBeCloseTo(0.7);
    expect(merged.totals.messages).toBe(4);
    expect(merged.byProject.map((p) => [p.projectKey, p.costUsd])).toEqual([
      [ACME, 3],
      [BETA, 3],
      [OTHER, 1],
    ]);
  });

  test("days are merged by day and project, oldest first", () => {
    const { summary: merged } = mergeSummaries([a, b], DAY.from, DAY.to);
    expect(merged.byDay.map((d) => [d.day, d.projectKey, d.costUsd])).toEqual([
      ["2026-10-10", ACME, 3],
      ["2026-10-10", BETA, 3],
      ["2026-10-11", OTHER, 1],
    ]);
  });

  test("models, origins and personas are summed", () => {
    const { summary: merged } = mergeSummaries([a, b], DAY.from, DAY.to);
    expect(merged.byModel).toEqual([{ model: "opus", costUsd: 7, tokens: 7000, priced: true }]);
    expect(merged.byOrigin).toEqual([{ origin: "terminal", costUsd: 7, tokens: 7000 }]);
    expect(merged.byPersona).toEqual([{ persona: null, costUsd: 7, tokens: 7000 }]);
  });

  test("a model that one host cannot price stays unpriced", () => {
    const unpriced = summary([["2026-10-10", ACME, 0]], {
      byModel: [{ model: "opus", costUsd: 0, tokens: 5, priced: false }],
    });
    const { summary: merged } = mergeSummaries(
      [a, { hostId: "c", summary: unpriced }],
      DAY.from,
      DAY.to,
    );
    expect(merged.byModel[0]?.priced).toBe(false);
  });

  test("the top sessions are the costliest, at most 20, each with the host it ran on", () => {
    const { summary: merged, sessionHost } = mergeSummaries([a, b], DAY.from, DAY.to);
    expect(merged.topSessions.map((s) => s.claudeSessionId)).toEqual(["s2", "s1"]);
    expect(sessionHost).toEqual({ s1: "a", s2: "b" });
    const many = (host: string) => ({
      hostId: host,
      summary: summary([["2026-10-10", ACME, 1]], {
        topSessions: Array.from({ length: 15 }, (_, i) => ({
          claudeSessionId: `${host}${i}`,
          sessionId: null,
          projectKey: ACME,
          title: null,
          cwd: null,
          costUsd: i,
          tokens: i,
        })),
      }),
    });
    expect(
      mergeSummaries([many("x"), many("y")], DAY.from, DAY.to).summary.topSessions,
    ).toHaveLength(20);
  });

  test("no host gives the summary of nothing for the period", () => {
    expect(mergeSummaries([], DAY.from, DAY.to).summary).toEqual(emptySummary(DAY.from, DAY.to));
  });
});

describe("clients-costs: what each client spent", () => {
  const names = [
    { id: "acme", name: "ACME", color: "indigo" as const },
    { id: "beta", name: "BETA", color: "rose" as const },
  ];

  test("clients are listed by spend with what no client claims as a row, and add up to the total", () => {
    const s = summary([
      ["2026-10-10", ACME, 2],
      ["2026-10-10", ACME2, 1],
      ["2026-10-10", BETA, 5],
      ["2026-10-10", OTHER, 1],
    ]);
    const rows = costByClient(s, scope, names, "Sem cliente");
    expect(rows).toEqual([
      { clientId: "beta", name: "BETA", color: "rose", costUsd: 5, tokens: 5000 },
      { clientId: "acme", name: "ACME", color: "indigo", costUsd: 3, tokens: 3000 },
      { clientId: UNASSIGNED, name: "Sem cliente", color: null, costUsd: 1, tokens: 1000 },
    ]);
    expect(rows.reduce((sum, r) => sum + r.costUsd, 0)).toBe(s.totals.costUsd);
  });

  test("a client that spent nothing has no row", () => {
    const rows = costByClient(summary([["2026-10-10", ACME, 2]]), scope, names, "Sem cliente");
    expect(rows.map((r) => r.clientId)).toEqual(["acme"]);
  });
});

describe("clients-costs: loading", () => {
  const calls: Array<[string, CostsFilter]> = [];
  const answers: Record<string, CostsSummary | null> = {
    "a|": summary([
      ["2026-10-10", ACME, 2],
      ["2026-10-10", OTHER, 1],
      ["2026-10-10", BETA, 4],
    ]),
    [`a|${ACME}`]: summary([["2026-10-10", ACME, 2]]),
    [`a|${BETA}`]: summary([["2026-10-10", BETA, 4]]),
    [`a|${OTHER}`]: summary([["2026-10-10", OTHER, 1]]),
    "b|": summary([["2026-10-11", ACME2, 1]]),
    [`b|${ACME2}`]: summary([["2026-10-11", ACME2, 1]]),
  };
  const ask = async (hostId: string, filter: CostsFilter) => {
    calls.push([hostId, filter]);
    return answers[`${hostId}|${filter.projectKey ?? ""}`] ?? null;
  };
  const load = (selection: string, hostIds = ["a", "b"], filter: Partial<CostsFilter> = {}) => {
    calls.length = 0;
    return loadCostsSummary({ hostIds, filter: { ...DAY, ...filter }, selection, scope, ask });
  };

  test("all clients asks each host once and merges", async () => {
    const loaded = await load(ALL_CLIENTS);
    expect(calls.map(([h]) => h)).toEqual(["a", "b"]);
    expect(loaded.summary.totals.costUsd).toBe(8);
    expect(loaded.failed).toEqual([]);
  });

  test("a client asks each host for its projects, then for each project of the client", async () => {
    const loaded = await load("acme");
    const keys = calls.map(([h, f]) => `${h}:${f.projectKey ?? "*"}`);
    expect(keys).toEqual(["a:*", "b:*", `a:${ACME}`, `b:${ACME2}`]);
    expect(loaded.summary.totals.costUsd).toBe(3);
    expect(loaded.summary.byProject.map((p) => p.projectKey).sort()).toEqual([ACME, ACME2]);
  });

  test("Unassigned asks for the projects that no client claims", async () => {
    const loaded = await load(UNASSIGNED, ["a"]);
    expect(calls.map(([, f]) => f.projectKey ?? "*")).toEqual(["*", OTHER]);
    expect(loaded.summary.totals.costUsd).toBe(1);
  });

  test("a project filter the person chose narrows within the client", async () => {
    const loaded = await load("acme", ["a"], { projectKey: ACME });
    expect(calls.map(([, f]) => f.projectKey ?? "*")).toEqual(["*", ACME]);
    expect(loaded.summary.totals.costUsd).toBe(2);
    const outside = await load("acme", ["a"], { projectKey: BETA });
    expect(outside.summary.totals.costUsd).toBe(0);
  });

  test("a host that does not answer is left out and named", async () => {
    const loaded = await load(ALL_CLIENTS, ["a", "ghost"]);
    expect(loaded.failed).toEqual(["ghost"]);
    expect(loaded.summary.totals.costUsd).toBe(7);
  });

  test("with a client selected, a host that does not answer is named and the others still count", async () => {
    const loaded = await load("acme", ["a", "ghost"]);
    expect(loaded.failed).toEqual(["ghost"]);
    expect(loaded.summary.totals.costUsd).toBe(2);
  });

  test("a client with no project on any host gives the summary of nothing", async () => {
    const loaded = await load("beta", ["b"]);
    expect(loaded.summary).toEqual(emptySummary(DAY.from, DAY.to));
  });
});
