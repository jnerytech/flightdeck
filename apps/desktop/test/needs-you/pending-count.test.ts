import { describe, expect, test } from "bun:test";
import { pendingCount } from "../../src/features/needs-you/domain/pending-count.ts";

const NOW = Date.parse("2026-11-09T12:30:00.000Z");
const HOUR = 60 * 60 * 1000;

const quietSession = {
  id: "s1",
  name: "session s1",
  cwd: "/w/s1",
  status: "running",
  pendingPermissions: [],
  updatedAt: new Date(NOW - 40 * 60_000).toISOString(),
  quietSince: new Date(NOW - 30 * 60_000).toISOString(),
};

/** A host `h` with nothing pending; each case adds what it counts. */
function state(over: object = {}) {
  return {
    hosts: [{ id: "h", name: "alfa", sessions: [] as object[] }],
    budgets: {},
    clientBudgets: [],
    clientList: [],
    loopAlerts: [],
    watches: {},
    cards: {},
    quietSnooze: {},
    meta: {},
    names: {},
    personas: {},
    ...over,
  } as never;
}

const crossedBudget = {
  scope: "host",
  projectKey: null,
  period: "day",
  action: "notify",
  limitUsd: 10,
  limitPct: null,
  spentUsd: 9,
  fraction: 0.9,
  crossed: [0.8],
  estimated: false,
};

describe("pending-count: the number on the Needs you badge", () => {
  test("a bar with nothing else pending shows the requests the sessions wait on", () => {
    expect(pendingCount(state(), 3, NOW)).toBe(3);
    expect(pendingCount(state(), 0, NOW)).toBe(0);
  });

  test("a crossed budget, a loop, a PR watch and a quiet session each add one to the requests", () => {
    const busy = state({
      hosts: [{ id: "h", name: "alfa", sessions: [quietSession] }],
      budgets: { h: [crossedBudget] },
      loopAlerts: [{ hostId: "h" }],
      watches: { "h/c1": { cardId: "c1", status: "needs_you" } },
    });
    expect(pendingCount(busy, 2, NOW)).toBe(6);
  });

  test("a budget that crossed no threshold and a watch that waits on nothing add nothing", () => {
    const calm = state({
      budgets: { h: [{ ...crossedBudget, crossed: [] }] },
      watches: { "h/c1": { cardId: "c1", status: "watching" } },
    });
    expect(pendingCount(calm, 1, NOW)).toBe(1);
  });

  test("a quiet session the person snoozed does not count until the snooze ends", () => {
    const snoozed = state({
      hosts: [{ id: "h", name: "alfa", sessions: [quietSession] }],
      quietSnooze: { "h/s1": NOW + HOUR },
    });
    expect(pendingCount(snoozed, 0, NOW)).toBe(0);
    expect(pendingCount(snoozed, 0, NOW + 2 * HOUR)).toBe(1);
  });
});
