import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { assistantDir } from "../src/assistant/paths.ts";
import { Budgets } from "../src/costs/budgets.ts";
import { Costs } from "../src/costs/costs.ts";
import { DEFAULT_PRICING } from "../src/costs/pricing.ts";
import { UsageIndexer } from "../src/costs/usage-indexer.ts";
import { autoApproveDir, historyExcludes } from "../src/permissions/auto-approve.ts";
import { EventStore } from "../src/store/event-store.ts";

const tokens = (model: string) => ({
  model,
  speed: "standard",
  input: 1_000_000,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
});

const AT = "2026-11-05T10:00:00.000Z";
const DAY = "2026-11-05";

function ledger() {
  const store = new EventStore(":memory:");
  const costs = new Costs({ db: store.db, pricing: DEFAULT_PRICING });
  const indexer = new UsageIndexer({
    db: store.db,
    roots: [],
    projectKey: (cwd) => `k:${cwd}`,
    cost: (t) => costs.cost(t),
  });
  return { db: store.db, costs, indexer };
}

type Row = {
  message_id: string;
  origin: string;
  provider: string | null;
  cost_usd: number | null;
  project_key: string;
};
/** Every row's fields; `SELECT *` so a missing column reads as `null` instead of failing the query. */
const rows = (db: EventStore["db"]) =>
  db
    .query<Record<string, unknown>, []>("SELECT * FROM usage_entries ORDER BY message_id")
    .all()
    .map(
      (r): Row => ({
        message_id: r.message_id as string,
        origin: r.origin as string,
        provider: (r.provider as string | undefined) ?? null,
        cost_usd: r.cost_usd as number | null,
        project_key: r.project_key as string,
      }),
    );

describe("assistant-usage", () => {
  test("an assistant row has its origin, provider and id; the same id twice is one row", () => {
    const { db, indexer } = ledger();
    const entry = {
      at: AT,
      model: "claude-sonnet-5-5",
      tokens: tokens("claude-sonnet-5-5"),
      projectPath: "/w/app",
      messageId: "assistant-r1",
      origin: "assistant" as const,
      provider: "anthropic",
    };
    indexer.record(entry);
    indexer.record(entry);
    expect(rows(db)).toEqual([
      {
        message_id: "assistant-r1",
        origin: "assistant",
        provider: "anthropic",
        cost_usd: 2,
        project_key: "k:/w/app",
      },
    ]);
  });

  test("the automatic approval's rows keep their origin, a fresh id each and no provider", () => {
    const { db, indexer } = ledger();
    for (let i = 0; i < 2; i++) {
      indexer.record({
        at: AT,
        model: "claude-sonnet-5-5",
        tokens: tokens("claude-sonnet-5-5"),
        projectPath: "/w",
      });
    }
    const all = rows(db);
    expect([
      all.length,
      all.every((r) => r.origin === "auto-approve" && r.provider === null),
    ]).toEqual([2, true]);
    expect(all.every((r) => r.message_id.startsWith("auto-approve-"))).toBe(true);
  });

  test("the cost a provider reports wins over the table; a model with no price and no cost stays unpriced", () => {
    const { db, indexer } = ledger();
    indexer.record({
      at: AT,
      model: "anthropic/claude-haiku-5.5",
      tokens: tokens("anthropic/claude-haiku-5.5"),
      projectPath: "/w",
      messageId: "a",
      origin: "assistant",
      provider: "openrouter",
      costUsd: 0.0123,
    });
    indexer.record({
      at: AT,
      model: "vendor/unknown-model",
      tokens: tokens("vendor/unknown-model"),
      projectPath: "/w",
      messageId: "b",
      origin: "assistant",
      provider: "openrouter",
    });
    expect(rows(db).map((r) => [r.message_id, r.cost_usd])).toEqual([
      ["a", 0.0123],
      ["b", null],
    ]);
  });

  test("the provider column is nullable: older rows read NULL and a read that lists the old columns still works", () => {
    const { db } = ledger();
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model,
         origin, speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ('old', 's', ?, ?, 'k', 'claude-sonnet-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, 0.5)`,
    ).run(AT, DAY);
    const column = db
      .query<{ name: string; notnull: number; dflt_value: unknown }, []>(
        "PRAGMA table_info(usage_entries)",
      )
      .all()
      .find((c) => c.name === "provider");
    expect([column?.name, column?.notnull, column?.dflt_value]).toEqual(["provider", 0, null]);
    expect(rows(db)).toEqual([
      { message_id: "old", origin: "terminal", provider: null, cost_usd: 0.5, project_key: "k" },
    ]);
  });

  test("Costs lists the assistant's origin, and a budget counts its spend", () => {
    const { db, costs, indexer } = ledger();
    indexer.record({
      at: AT,
      model: "claude-sonnet-5-5",
      tokens: tokens("claude-sonnet-5-5"),
      projectPath: "/w",
      messageId: "assistant-1",
      origin: "assistant",
      provider: "host",
    });
    const summary = costs.summary({ from: DAY, to: DAY });
    expect(summary.byOrigin.map((o) => [o.origin, o.costUsd])).toEqual([["assistant", 2]]);
    expect(costs.summary({ from: DAY, to: DAY, origin: "assistant" }).byOrigin.length).toBe(1);
    const budgets = new Budgets({ db, now: () => Date.parse(AT), day: () => DAY });
    budgets.set({ scope: "host", period: "day", limitUsd: 10, action: "notify" });
    expect(budgets.list()[0]?.spentUsd).toBe(2);
  });

  test("the assistant's scratch folder is its own, and the history leaves it out", () => {
    expect(assistantDir("/data")).toBe(join("/data", "assistant"));
    expect(assistantDir("/data")).not.toBe(autoApproveDir("/data"));
    expect(historyExcludes({ dataDir: "/data", history: { excludeCwds: ["/x"] } })).toEqual([
      "/x",
      autoApproveDir("/data"),
      assistantDir("/data"),
    ]);
  });
});
