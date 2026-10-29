import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { Config } from "../src/config.ts";
import { Costs } from "../src/costs/costs.ts";
import {
  costOf,
  DEFAULT_PRICING,
  PRICING_DATE,
  type Pricing,
  resolvePricing,
} from "../src/costs/pricing.ts";
import { UsageIndexer, type UsageTokens } from "../src/costs/usage-indexer.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { insertSession, SESSION, usageEntries, writeUsageTranscript } from "./usage-helpers.ts";

const TOKEN = "prices-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const M = 1_000_000;
const tokens = (fields: Partial<UsageTokens>): UsageTokens => ({
  model: "claude-opus-5-5",
  speed: "standard",
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  ...fields,
});
const price = (fields: Partial<UsageTokens>, pricing: Pricing = DEFAULT_PRICING) =>
  costOf(tokens(fields), pricing);

/** Usage entries of the fixtures priced by `costs`, in a store of their own. */
async function indexed(costs: (db: EventStore["db"]) => Costs) {
  const store = new EventStore(":memory:");
  const root = join(tempDir("fd-prices-"), "projects");
  mkdirSync(root);
  writeUsageTranscript(root, "proj", "/work/app");
  const ledger = costs(store.db);
  await new UsageIndexer({
    db: store.db,
    roots: [root],
    projectKey: (cwd) => `k:${basename(cwd)}`,
    cost: (t) => ledger.cost(t),
  }).pass();
  return { db: store.db, costs: ledger };
}

const costById = (db: EventStore["db"]) =>
  Object.fromEntries(usageEntries(db).map((e) => [e.message_id, e.cost_usd]));

/** A `turn.result` of the managed session `sessionId`, with the SDK's running total. */
function sdkTotal(db: EventStore["db"], sessionId: string, seq: number, costUsd: number) {
  db.query(
    "INSERT INTO events (session_id, seq, ts, type, payload) VALUES (?, ?, '2026-10-01T12:00:00.000Z', 'turn.result', ?)",
  ).run(sessionId, seq, JSON.stringify({ type: "turn.result", costUsd }));
}

/** An entry with a given cost (the divergence check only sums them). */
function entry(db: EventStore["db"], id: string, session: string, model: string, cost: number) {
  db.query(
    `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
       speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
     VALUES (?, ?, '2026-10-01T12:00:00.000Z', '2026-10-01', 'k', ?, 'app', 'standard', 1, 1, 0, 0, 0, ?)`,
  ).run(id, session, model, cost);
}

describe("precos", () => {
  test("a tabela padrão é a de 06/10/2026, com cache read do Haiku documentado", () => {
    expect(PRICING_DATE).toBe("2026-10-06");
    expect(DEFAULT_PRICING).toEqual({
      models: {
        "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
        "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
        "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
        "claude-haiku-5-5": {
          input: 0.1,
          output: 0.5,
          cacheRead: 0.01,
          tiers: [{ abovePromptTokens: 100_000, input: 0.5, output: 2.5 }],
        },
      },
      cacheWrite5mMultiplier: 1.25,
      cacheWrite1hMultiplier: 2,
      fastMultiplier: { "claude-opus-5-5": 2 },
    });
  });

  test("custo com input, output, cache read e escrita de cache de 5 minutos e de 1 hora", () => {
    // 0,4 + 0,2 + 0,2 + 200k × 4 × 1,25 + 100k × 4 × 2 = 2,6.
    const cost = price({
      input: 100_000,
      output: 10_000,
      cacheRead: 1_000_000,
      cacheWrite5m: 200_000,
      cacheWrite1h: 100_000,
    });
    expect(cost ?? 0).toBeCloseTo(2.6, 10);
    expect(
      price({ model: "claude-fable-5-1", input: M, output: M, cacheRead: M }) ?? 0,
    ).toBeCloseTo(60.25, 10);
    expect(price({ model: "claude-sonnet-5-5", output: M }) ?? 0).toBeCloseTo(10, 10);
  });

  test("tier do Haiku acima de 100 mil tokens de prompt, com a escrita de cache pelo input do tier", () => {
    const haiku = (fields: Partial<UsageTokens>) => price({ model: "claude-haiku-5-5", ...fields });
    expect(haiku({ input: 100_000, output: M }) ?? 0).toBeCloseTo(0.51, 10);
    expect(haiku({ input: 100_001, output: M }) ?? 0).toBeCloseTo(0.0500005 + 2.5, 10);
    // 110 mil de prompt: 50k × 0,5 + 60k × 0,5 × 2.
    expect(haiku({ input: 50_000, cacheWrite1h: 60_000 }) ?? 0).toBeCloseTo(0.085, 10);
  });

  test("fast mode multiplica o modelo que tem multiplicador; modelo sem preço custa null", () => {
    expect(price({ speed: "fast", input: M, output: M }) ?? 0).toBeCloseTo(48, 10);
    expect(
      price({ model: "claude-sonnet-5-5", speed: "fast", input: M, output: M }) ?? 0,
    ).toBeCloseTo(12, 10);
    expect(price({ model: "claude-mystery-9", input: M })).toBeNull();
  });

  test("pricing da config sobrescreve modelo a modelo e cada multiplicador", () => {
    expect(resolvePricing(Config.parse({}).pricing)).toEqual(DEFAULT_PRICING);
    const pricing = resolvePricing(
      Config.parse({
        pricing: {
          models: {
            "claude-opus-5-5": { input: 5, output: 25, cacheRead: 0.5 },
            "claude-mystery-9": { input: 1, output: 1, cacheRead: 0 },
          },
          cacheWrite1hMultiplier: 3,
          fastMultiplier: { "claude-sonnet-5-5": 1.5 },
        },
      }).pricing,
    );
    expect(pricing).toEqual({
      models: {
        ...DEFAULT_PRICING.models,
        "claude-opus-5-5": { input: 5, output: 25, cacheRead: 0.5 },
        "claude-mystery-9": { input: 1, output: 1, cacheRead: 0 },
      },
      cacheWrite5mMultiplier: 1.25,
      cacheWrite1hMultiplier: 3,
      fastMultiplier: { "claude-opus-5-5": 2, "claude-sonnet-5-5": 1.5 },
    });
    expect(price({ model: "claude-mystery-9", input: M }, pricing)).toBe(1);
  });

  test("as entradas saem com o custo da tabela, e costs.reprice recalcula com a tabela atual", async () => {
    let current = DEFAULT_PRICING;
    const { db, costs } = await indexed(
      (db) => new Costs({ db, pricing: DEFAULT_PRICING, loadPricing: () => current }),
    );
    const before = costById(db);
    expect(before.msg_A ?? 0).toBeCloseTo(0.0037, 12);
    expect(before.msg_B ?? 0).toBeCloseTo(0.00088, 12);
    expect(before.msg_C ?? 0).toBeCloseTo(0.00106, 12);
    expect(before.msg_D).toBeNull();
    expect(before.msg_S1 ?? 0).toBeCloseTo(0.00025, 12);
    current = resolvePricing({
      models: { "claude-mystery-9": { input: M, output: 0, cacheRead: 0 } },
      fastMultiplier: { "claude-opus-5-5": 1 },
    });
    expect(costs.reprice()).toEqual({ entries: 5 });
    const after = costById(db);
    expect(after.msg_A ?? 0).toBeCloseTo(0.0037, 12);
    expect(after.msg_B ?? 0).toBeCloseTo(0.00044, 12);
    expect(after.msg_D).toBe(7);
    // New messages are priced with the reloaded table too.
    expect(costs.cost(tokens({ model: "claude-mystery-9", input: 1 }))).toBe(1);
  });

  test("costs.status: modelos sem preço e divergência com o total_cost_usd do SDK acima de 10% e de US$ 0,05", async () => {
    const { db, costs } = await indexed((db) => new Costs({ db, pricing: DEFAULT_PRICING }));
    // The fixtures' session: about US$ 0.006 computed, the SDK said US$ 1.
    insertSession(db, "m-1", SESSION, "/work/app");
    sdkTotal(db, "m-1", 1, 0.5);
    sdkTotal(db, "m-1", 2, 1);
    // 9% apart: within the limit.
    insertSession(db, "m-2", "s-close", "/work/app");
    entry(db, "x-1", "s-close", "claude-sonnet-5-5", 10);
    sdkTotal(db, "m-2", 1, 10.9);
    // 15% apart: over it.
    insertSession(db, "m-3", "s-far", "/work/app");
    entry(db, "y-1", "s-far", "claude-sonnet-5-5", 7);
    entry(db, "y-2", "s-far", "claude-fable-5-1", 3);
    sdkTotal(db, "m-3", 1, 11.5);
    // Five times as much, but only US$ 0.04 apart.
    insertSession(db, "m-4", "s-small", "/work/app");
    entry(db, "z-1", "s-small", "claude-sonnet-5-5", 0.01);
    sdkTotal(db, "m-4", 1, 0.05);
    // No SDK total: nothing to compare.
    insertSession(db, "m-5", "s-none", "/work/app");
    entry(db, "w-1", "s-none", "claude-sonnet-5-5", 1);
    const status = costs.status();
    expect(status.pricingDate).toBe("2026-10-06");
    expect(status.unpriced).toEqual([{ model: "claude-mystery-9", entries: 1, tokens: 10 }]);
    expect(
      status.divergences.map((d) => [
        d.claudeSessionId,
        d.model,
        d.computedUsd.toFixed(5),
        d.sdkUsd,
      ]),
    ).toEqual([
      [SESSION, "claude-opus-5-5", "0.00589", 1],
      ["s-far", "claude-sonnet-5-5", "10.00000", 11.5],
    ]);
  });

  test("costs.status e costs.reprice pelo protocolo; host.info anuncia costs", async () => {
    const { db, costs } = await indexed((db) => new Costs({ db, pricing: DEFAULT_PRICING }));
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
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toEqual([
      "costs",
    ]);
    expect(await client.data("costs.reprice", {})).toEqual({ entries: 5 });
    expect(await client.data("costs.status", {})).toEqual({
      pricingDate: "2026-10-06",
      unpriced: [{ model: "claude-mystery-9", entries: 1, tokens: 10 }],
      divergences: [],
    });
    expect(usageEntries(db)).toHaveLength(5);
  });
});
