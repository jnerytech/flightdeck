import { afterEach, describe, expect, test } from "bun:test";
import type { Budget } from "@flightdeck/protocol";
import { Budgets, type BudgetUpdate } from "../src/costs/budgets.ts";
import { Quota } from "../src/quota/quota.ts";
import { costsHandlers } from "../src/server/handlers/costs.ts";
import { EventStore } from "../src/store/event-store.ts";
import { manualTime } from "./time-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const HOUR = 3_600_000;
const START = Date.UTC(2026, 9, 15, 12);
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString();

/** Budgets over a plan quota and usage entries, on a manual clock (2026-10-15 12:00 UTC). */
function setup() {
  const db = new EventStore(":memory:").db;
  const time = manualTime(START);
  const quota = new Quota({ pauseAt: null, now: time.now, timers: time.timers });
  const budgets = new Budgets({ db, quota, now: time.now, day: utcDay, timers: time.timers });
  cleanups.push(() => budgets.stop());
  budgets.start();
  const frames: BudgetUpdate[] = [];
  budgets.watch((update) => frames.push(update));
  let n = 0;
  /** An entry of `cost` in project `key`, `agoMs` before now. */
  const spend = (cost: number, key: string, agoMs: number) => {
    const at = iso(time.now() - agoMs);
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, 's', ?, ?, ?, 'claude-opus-5-5', 'terminal', 'standard', 0, 0, 0, 0, 0, ?)`,
    ).run(`m${++n}`, at, utcDay(Date.parse(at)), key, cost);
  };
  /** A reading of one window: `utilization` of it used, resetting `resetsInMs` from now. */
  const read = (window: string, utilization: number, resetsInMs: number) =>
    quota.record([{ window, utilization, status: "allowed", resetsAt: time.now() + resetsInMs }]);
  const thresholds = () => frames.flatMap((f) => f.threshold ?? []);
  return { budgets, frames, quota, read, spend, thresholds, time };
}

const HOST_5H = { scope: "host", window: "five_hour", limitPct: 0.5, action: "notify" } as const;

const refusal = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, reason, params } = error as {
      code: string;
      reason?: string;
      params?: Record<string, string>;
    };
    return { code, reason, params };
  }
};

describe("budget-quota: a budget in terms of the plan quota window, not dollars (issue #1248)", () => {
  test("a host budget of half the 5-hour window notifies at 50%, 80% and 100% of that half, once each", () => {
    const { budgets, read, thresholds, time } = setup();
    read("five_hour", 0.1, 2 * HOUR);
    const budget = budgets.setWindow(HOST_5H);
    expect(budget).toMatchObject({
      scope: "host",
      period: "five_hour",
      limitUsd: 0,
      limitPct: 0.5,
      spentPct: 0.1,
      estimated: false,
      periodKey: iso(START + 2 * HOUR),
      crossed: [],
    });
    expect(budget.fraction).toBeCloseTo(0.2);
    read("five_hour", 0.25, 2 * HOUR);
    read("five_hour", 0.4, 2 * HOUR);
    read("five_hour", 0.5, 2 * HOUR);
    // The same reading again is not news.
    read("five_hour", 0.5, 2 * HOUR);
    expect(thresholds()).toEqual([0.5, 0.8, 1]);
    const [now] = budgets.list();
    expect(now?.crossed).toEqual([0.5, 0.8, 1]);
    expect(time.now()).toBe(START);
  });

  test("a queue budget holds the new cards at 100% of its share and the next window releases them", () => {
    const { budgets, read, time } = setup();
    budgets.setWindow({ ...HOST_5H, action: "queue" });
    read("five_hour", 0.3, 2 * HOUR);
    expect(budgets.blocked("kA")).toBe(false);
    read("five_hour", 0.5, 2 * HOUR);
    expect(budgets.blocked("kA")).toBe(true);
    // The window resets: its reading is gone until a new one arrives, and the cards go on.
    time.advance(2 * HOUR + 60_000);
    expect(budgets.blocked("kA")).toBe(false);
    read("five_hour", 0.1, 5 * HOUR);
    expect(budgets.blocked("kA")).toBe(false);
    const [next] = budgets.list();
    expect(next?.crossed).toEqual([]);
    expect(next?.periodKey).toBe(iso(time.now() + 5 * HOUR));
  });

  test("a project's share of the window is its part of the estimated cost since the window began, and it says so", () => {
    const { budgets, read, spend } = setup();
    // The window began 3 hours ago: the 4-hour-old entry does not count.
    spend(3, "kA", HOUR);
    spend(1, "kB", HOUR);
    spend(100, "kA", 4 * HOUR);
    read("five_hour", 0.4, 2 * HOUR);
    const project = budgets.setWindow({
      scope: "project",
      projectKey: "kA",
      window: "five_hour",
      limitPct: 0.3,
      action: "queue",
    });
    expect(project).toMatchObject({ spentUsd: 3, estimated: true, crossed: [0.5, 0.8, 1] });
    expect(project.spentPct).toBeCloseTo(0.3);
    expect(project.fraction).toBeCloseTo(1);
    expect(budgets.blocked("kA")).toBe(true);
    expect(budgets.blocked("kB")).toBe(false);
  });

  test("the weekly window counts the entries of the last 7 days, not of the last 5 hours", () => {
    const { budgets, read, spend } = setup();
    spend(1, "kA", 30 * HOUR);
    spend(1, "kB", 30 * HOUR);
    read("seven_day", 0.2, 3 * 24 * HOUR);
    const weekly = budgets.setWindow({
      scope: "project",
      projectKey: "kA",
      window: "seven_day",
      limitPct: 0.2,
      action: "notify",
    });
    expect(weekly.spentPct).toBeCloseTo(0.1);
    expect(weekly.estimated).toBe(true);
  });

  test("with no reading of the window the budget is at zero and nothing alerts until one arrives", () => {
    const { budgets, read, thresholds } = setup();
    const budget = budgets.setWindow(HOST_5H);
    expect(budget).toMatchObject({ spentPct: 0, fraction: 0, periodKey: "unread", crossed: [] });
    expect(thresholds()).toEqual([]);
    // A jump past two thresholds announces the highest and records both.
    read("five_hour", 0.45, 2 * HOUR);
    expect(thresholds()).toEqual([0.8]);
    expect(budgets.list()[0]?.crossed).toEqual([0.5, 0.8]);
  });

  test("a reading with a utilization that is not a number of the plan never makes the budget non-finite", () => {
    const { budgets, read } = setup();
    // The CLI sends `1e999` as Infinity; a project with no entries has a share of zero.
    read("five_hour", Number.POSITIVE_INFINITY, 2 * HOUR);
    const project = budgets.setWindow({
      scope: "project",
      projectKey: "kA",
      window: "five_hour",
      limitPct: 0.5,
      action: "queue",
    });
    expect(Number.isFinite(project.fraction)).toBe(true);
    expect(Number.isFinite(project.spentPct ?? Number.NaN)).toBe(true);
    const host = budgets.setWindow(HOST_5H);
    expect(host.spentPct).toBe(1);
    expect(host.fraction).toBe(2);
  });

  test("a reading without a reset has no period to keep alerts in: the budget ignores it", () => {
    const { budgets, quota, thresholds } = setup();
    quota.record([{ window: "five_hour", utilization: 0.9, status: "allowed", resetsAt: null }]);
    const budget = budgets.setWindow(HOST_5H);
    expect(budget).toMatchObject({ spentPct: 0, periodKey: "unread", crossed: [] });
    expect(thresholds()).toEqual([]);
  });

  test("a reset that moves by seconds between readings is the same window: no alert twice", () => {
    const { budgets, read, thresholds } = setup();
    budgets.setWindow(HOST_5H);
    read("five_hour", 0.4, 2 * HOUR);
    const first = budgets.list()[0]?.periodKey;
    // The CLI rounds its reset differently a minute later.
    read("five_hour", 0.41, 2 * HOUR + 20_000);
    expect(budgets.list()[0]?.periodKey).toBe(first as string);
    expect(budgets.list()[0]?.crossed).toEqual([0.5, 0.8]);
    expect(thresholds()).toEqual([0.8]);
  });

  test("a window budget needs the plan quota: a host without it refuses, as feature_off", () => {
    const db = new EventStore(":memory:").db;
    const budgets = new Budgets({ db });
    const server = { need: () => budgets };
    const handler = costsHandlers["budget.setQuota"] as unknown as (
      payload: unknown,
      ctx: { server: typeof server },
    ) => unknown;
    expect(refusal(() => handler(HOST_5H, { server }))).toMatchObject({
      code: "invalid_state",
      reason: "feature_off",
      params: { feature: "quotaBudgets" },
    });
    expect(budgets.list()).toEqual([]);
  });

  test("a dollar budget still works beside a window one, and says it is not a share of a window", () => {
    const { budgets } = setup();
    const dollars = budgets.set({ scope: "host", period: "day", limitUsd: 10, action: "notify" });
    expect(dollars).toMatchObject({
      limitUsd: 10,
      limitPct: null,
      spentPct: null,
      estimated: false,
    });
    const window = budgets.setWindow(HOST_5H);
    expect(budgets.list().map((b: Budget) => b.id)).toEqual([dollars.id, window.id]);
  });

  test("a project window budget needs its project, as a dollar one does", () => {
    const { budgets } = setup();
    expect(
      refusal(() =>
        budgets.setWindow({
          scope: "project",
          window: "five_hour",
          limitPct: 0.5,
          action: "queue",
        }),
      ),
    ).toMatchObject({ code: "bad_request", reason: "budget_needs_project" });
    expect(budgets.list()).toEqual([]);
  });

  test("a budget changes from dollars to a window and back, keeping its id and its creation date", () => {
    const { budgets, time } = setup();
    const dollars = budgets.set({ scope: "host", period: "day", limitUsd: 10, action: "notify" });
    time.advance(60_000);
    const window = budgets.setWindow({ ...HOST_5H, id: dollars.id });
    expect(window).toMatchObject({
      id: dollars.id,
      createdAt: dollars.createdAt,
      period: "five_hour",
      limitUsd: 0,
      limitPct: 0.5,
    });
    const back = budgets.set({
      id: dollars.id,
      scope: "host",
      period: "month",
      limitUsd: 20,
      action: "notify",
    });
    expect(back).toMatchObject({ period: "month", limitUsd: 20, limitPct: null, spentPct: null });
    expect(budgets.list()).toHaveLength(1);
  });
});
