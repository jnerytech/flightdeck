import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Budgets } from "../src/costs/budgets.ts";
import { EventStore } from "../src/store/event-store.ts";

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Budgets of a day and a month on a store with a spread of entries; `sqls` is what they asked it. */
function setup() {
  const db = new EventStore(":memory:").db;
  const sqls: string[] = [];
  const spy = new Proxy(db, {
    get(target, prop) {
      if (prop === "query") {
        return (sql: string) => {
          sqls.push(sql);
          return target.query(sql);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database;
  let n = 0;
  const spend = (day: string, cost: number, key = "kA") =>
    db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, 's', ?, ?, ?, 'm', 'terminal', 'standard', 0, 0, 0, 0, 0, ?)`,
      )
      .run(`m${++n}`, `${day}T12:00:00.000Z`, day, key, cost);
  const now = Date.UTC(2026, 9, 31, 12); // 2026-10-31, the last day of its month
  const budgets = new Budgets({ db: spy, now: () => now, day: utcDay });
  return { db, sqls, spend, budgets };
}

describe("orcamentos-indice: the spent of a budget is read from the days it covers", () => {
  test("a day budget counts that day only, a month budget counts its month only, also at the edges of the month", () => {
    const { spend, budgets } = setup();
    spend("2026-09-30", 100);
    spend("2026-10-01", 1);
    spend("2026-10-31", 2);
    spend("2026-10-31", 4, "kB");
    spend("2026-11-01", 100);
    budgets.set({ scope: "host", period: "day", limitUsd: 100, action: "notify" });
    budgets.set({ scope: "host", period: "month", limitUsd: 100, action: "notify" });
    budgets.set({
      scope: "project",
      projectKey: "kB",
      period: "month",
      limitUsd: 100,
      action: "notify",
    });
    const spent = budgets.list().map((b) => [b.period, b.projectKey ?? null, b.spentUsd]);
    expect(spent).toEqual([
      ["day", null, 6],
      ["month", null, 7],
      ["month", "kB", 4],
    ]);
  });

  test("the query that sums a period searches the index on the day and does not scan the entries", () => {
    const { db, sqls, spend, budgets } = setup();
    spend("2026-10-31", 2);
    budgets.set({ scope: "host", period: "day", limitUsd: 10, action: "notify" });
    budgets.list();
    const sql = sqls.find((s) => s.includes("FROM usage_entries") && s.includes("TOTAL(cost_usd)"));
    expect(sql).toBeDefined();
    const plan = db
      .query(`EXPLAIN QUERY PLAN ${sql}`)
      .all({ period: "2026-10-31", key: null } as never) as Array<{ detail: string }>;
    const details = plan.map((p) => p.detail).join(" | ");
    expect(details).toContain("USING INDEX usage_entries_day");
    expect(details).not.toContain("SCAN usage_entries");
  });
});
