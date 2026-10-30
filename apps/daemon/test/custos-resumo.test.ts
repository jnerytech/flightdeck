import { afterEach, describe, expect, test } from "bun:test";
import { Costs } from "../src/costs/costs.ts";
import { DEFAULT_PRICING } from "../src/costs/pricing.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { insertCard, insertCardRun, insertSession, insertStepRun } from "./usage-helpers.ts";

const TOKEN = "costs-summary-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Db = EventStore["db"];

interface Entry {
  id: string;
  session: string;
  day: string;
  key: string;
  model: string;
  origin: string;
  cost: number | null;
  input?: number;
  output?: number;
  cacheRead?: number;
}

function insert(db: Db, e: Entry) {
  db.query(
    `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
       speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, 0, 0, ?)`,
  ).run(
    e.id,
    e.session,
    `${e.day}T12:00:00.000Z`,
    e.day,
    e.key,
    e.model,
    e.origin,
    e.input ?? 0,
    e.output ?? 0,
    e.cacheRead ?? 0,
    e.cost,
  );
}

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const MYSTERY = "claude-mystery-9";

/** Four entries in 2026-10-01..02 and one the day before, over four sessions. */
function setup() {
  const store = new EventStore(":memory:");
  const db = store.db;
  const entries: Entry[] = [
    {
      id: "m1",
      session: "s1",
      day: "2026-10-01",
      key: "kA",
      model: OPUS,
      origin: "terminal",
      cost: 1,
      input: 100,
      output: 10,
      cacheRead: 1_000_000,
    },
    {
      id: "m2",
      session: "s1",
      day: "2026-10-01",
      key: "kA",
      model: OPUS,
      origin: "subagent",
      cost: 0.5,
      output: 5,
    },
    {
      id: "m3",
      session: "s2",
      day: "2026-10-02",
      key: "kB",
      model: SONNET,
      origin: "app",
      cost: 2,
      output: 20,
      cacheRead: 500_000,
    },
    {
      id: "m4",
      session: "s3",
      day: "2026-10-02",
      key: "kA",
      model: MYSTERY,
      origin: "terminal",
      cost: null,
      input: 7,
      output: 3,
    },
    {
      id: "m5",
      session: "s4",
      day: "2026-09-30",
      key: "kA",
      model: OPUS,
      origin: "workflow",
      cost: 9,
    },
  ];
  for (const e of entries) insert(db, e);
  db.query(
    `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
     VALUES ('s1', '/work/app', 'Arrume o build', 'x', 'x', 3, 'external', 'f')`,
  ).run();
  insertSession(db, "m-s2", "s2", "/work/b");
  insertSession(db, "m-s4", "s4", "/gone/wt");
  insertCard(db, "c-1", "p-1", "/repos/loja");
  insertCardRun(db, "r-1", "c-1", "m-s2");
  insertStepRun(db, "r-2", "c-1", "m-s4");
  return { db, costs: new Costs({ db, pricing: DEFAULT_PRICING }) };
}

const RANGE = { from: "2026-10-01", to: "2026-10-02" };

describe("custos-resumo", () => {
  test("costs.summary: totais, série por dia e projeto, quebras, top sessões e economia do cache", () => {
    const { costs } = setup();
    const summary = costs.summary(RANGE);
    expect(summary.totals.cacheSavingsUsd).toBeCloseTo(3.8 + 0.9, 10);
    expect({ ...summary, totals: { ...summary.totals, cacheSavingsUsd: 0 } }).toEqual({
      ...RANGE,
      totals: {
        costUsd: 3.5,
        tokens: { input: 107, output: 38, cacheRead: 1_500_000, cacheWrite5m: 0, cacheWrite1h: 0 },
        cacheSavingsUsd: 0,
        messages: 4,
        unpricedMessages: 1,
      },
      byDay: [
        { day: "2026-10-01", projectKey: "kA", costUsd: 1.5, tokens: 1_000_115 },
        { day: "2026-10-02", projectKey: "kA", costUsd: 0, tokens: 10 },
        { day: "2026-10-02", projectKey: "kB", costUsd: 2, tokens: 500_020 },
      ],
      byProject: [
        { projectKey: "kB", costUsd: 2, tokens: 500_020 },
        { projectKey: "kA", costUsd: 1.5, tokens: 1_000_125 },
      ],
      byModel: [
        { model: SONNET, costUsd: 2, tokens: 500_020, priced: true },
        { model: OPUS, costUsd: 1.5, tokens: 1_000_115, priced: true },
        { model: MYSTERY, costUsd: 0, tokens: 10, priced: false },
      ],
      byOrigin: [
        { origin: "app", costUsd: 2, tokens: 500_020 },
        { origin: "terminal", costUsd: 1, tokens: 1_000_120 },
        { origin: "subagent", costUsd: 0.5, tokens: 5 },
      ],
      // No session of these has a persona: all of it is in the one row with none.
      byPersona: [{ persona: null, costUsd: 3.5, tokens: 1_500_145 }],
      topSessions: [
        {
          claudeSessionId: "s2",
          sessionId: "m-s2",
          projectKey: "kB",
          title: null,
          cwd: "/work/b",
          costUsd: 2,
          tokens: 500_020,
        },
        {
          claudeSessionId: "s1",
          sessionId: null,
          projectKey: "kA",
          title: "Arrume o build",
          cwd: "/work/app",
          costUsd: 1.5,
          tokens: 1_000_115,
        },
        {
          claudeSessionId: "s3",
          sessionId: null,
          projectKey: "kA",
          title: null,
          cwd: null,
          costUsd: 0,
          tokens: 10,
        },
      ],
    });
  });

  test("filtros por projeto, modelo e origem; top sessões param em 20", () => {
    const { db, costs } = setup();
    expect(costs.summary({ ...RANGE, projectKey: "kA" }).totals.costUsd).toBe(1.5);
    const mystery = costs.summary({ ...RANGE, model: MYSTERY }).totals;
    expect([mystery.costUsd, mystery.messages, mystery.unpricedMessages]).toEqual([0, 1, 1]);
    expect(costs.summary({ ...RANGE, origin: "subagent" }).byOrigin).toEqual([
      { origin: "subagent", costUsd: 0.5, tokens: 5 },
    ]);
    for (let i = 0; i < 22; i++) {
      insert(db, {
        id: `x${i}`,
        session: `t${String(i).padStart(2, "0")}`,
        day: "2026-10-03",
        key: "kC",
        model: OPUS,
        origin: "terminal",
        cost: i,
      });
    }
    const top = costs.summary({ from: "2026-10-03", to: "2026-10-03" }).topSessions;
    expect(top.map((s) => s.claudeSessionId)).toEqual(
      Array.from({ length: 20 }, (_, i) => `t${String(21 - i).padStart(2, "0")}`),
    );
  });

  test("costs.session soma as subagentes; somas por sessões, card e execução", () => {
    const { costs } = setup();
    expect(costs.session("s1")).toEqual({
      claudeSessionId: "s1",
      costUsd: 1.5,
      tokens: 1_000_115,
      subagentCostUsd: 0.5,
      byModel: [{ model: OPUS, costUsd: 1.5, tokens: 1_000_115 }],
    });
    expect(costs.session("nada")).toEqual({
      claudeSessionId: "nada",
      costUsd: 0,
      tokens: 0,
      subagentCostUsd: 0,
      byModel: [],
    });
    expect(costs.sessions(["s1", "s2", "nada"])).toEqual({ s1: 1.5, s2: 2 });
    expect(costs.card("c-1")).toBe(11);
    expect(costs.run("r-1")).toBe(2);
    expect(costs.run("r-2")).toBe(9);
  });

  test("costs.export gera CSV estável: uma linha por dia, projeto, modelo e origem", () => {
    const { db, costs } = setup();
    insert(db, {
      id: "q1",
      session: "s9",
      day: "2026-10-02",
      key: 'k,"x"',
      model: OPUS,
      origin: "app",
      cost: 0.25,
    });
    expect(costs.export(RANGE)).toEqual({
      filename: "flightdeck-custos-2026-10-01-a-2026-10-02.csv",
      csv: [
        "day,project_key,model,origin,input,output,cache_read,cache_write_5m,cache_write_1h,cost_usd",
        "2026-10-01,kA,claude-opus-5-5,subagent,0,5,0,0,0,0.500000",
        "2026-10-01,kA,claude-opus-5-5,terminal,100,10,1000000,0,0,1.000000",
        // A comma sorts before letters: the quoted key comes first in its day.
        '2026-10-02,"k,""x""",claude-opus-5-5,app,0,0,0,0,0,0.250000',
        "2026-10-02,kA,claude-mystery-9,terminal,7,3,0,0,0,",
        "2026-10-02,kB,claude-sonnet-5-5,app,0,20,500000,0,0,2.000000",
        "",
      ].join("\n"),
    });
    expect(costs.export({ ...RANGE, projectKey: "kB" }).csv.split("\n")).toHaveLength(3);
  });

  test("os comandos pelo protocolo; período invertido é recusado", async () => {
    const { costs } = setup();
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      costs,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const summary = await client.data<{ totals: { costUsd: number } }>("costs.summary", RANGE);
    expect(summary?.totals.costUsd).toBe(3.5);
    expect(
      (await client.data<{ costUsd: number }>("costs.session", { claudeSessionId: "s1" }))?.costUsd,
    ).toBe(1.5);
    expect(await client.data("costs.sessions", { claudeSessionIds: ["s2"] })).toEqual({
      costs: { s2: 2 },
    });
    expect(await client.data("costs.card", { cardId: "c-1" })).toEqual({ costUsd: 11 });
    expect(await client.data("costs.run", { runId: "r-2" })).toEqual({ costUsd: 9 });
    const csv = await client.data<{ csv: string; filename: string }>("costs.export", RANGE);
    expect(csv?.filename).toBe("flightdeck-custos-2026-10-01-a-2026-10-02.csv");
    expect(
      await client.request("costs.summary", { from: "2026-10-02", to: "2026-10-01" }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
    expect(
      await client.request("costs.summary", { from: "ontem", to: "2026-10-01" }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });
});
