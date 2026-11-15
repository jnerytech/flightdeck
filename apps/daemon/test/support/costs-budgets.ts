import { Budgets, type BudgetUpdate } from "../../src/costs/budgets.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { manualTime } from "./time-helpers.ts";

export const cleanups: Array<() => unknown> = [];
export async function runCleanups() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Budgets on a manual clock (2026-10-15 12:00 UTC) over a store of their own. */
export function setup(db = new EventStore(":memory:").db) {
  const time = manualTime(Date.UTC(2026, 9, 15, 12));
  const budgets = new Budgets({ db, now: time.now, day: utcDay, timers: time.timers });
  cleanups.push(() => budgets.stop());
  budgets.start();
  const frames: BudgetUpdate[] = [];
  budgets.watch((update) => frames.push(update));
  let n = 0;
  /** An entry of `cost` in project `key` on `day` (today when absent). */
  const spend = (cost: number, key = "kA", day = utcDay(time.now())) => {
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, 's', ?, ?, ?, 'claude-opus-5-5', 'terminal', 'standard', 0, 0, 0, 0, 0, ?)`,
    ).run(`m${++n}`, `${day}T12:00:00.000Z`, day, key, cost);
  };
  return { db, time, budgets, frames, spend };
}

export const HOST_DAY = {
  scope: "host",
  period: "day",
  limitUsd: 10,
  action: "notify",
} as const;
