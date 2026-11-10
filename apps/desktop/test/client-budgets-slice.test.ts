import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type ClientBudgetsCore,
  ClientBudgetsSlice,
} from "../src/features/costs/client-budgets-store.ts";

/** The intervals that were started and not yet cleared, by the id `setInterval` returned. */
const live = new Set<number>();
const realSet = globalThis.setInterval;
const realClear = globalThis.clearInterval;
let next = 0;

beforeEach(() => {
  live.clear();
  globalThis.setInterval = ((): number => {
    next += 1;
    live.add(next);
    return next;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((id: number) => {
    live.delete(id);
  }) as unknown as typeof clearInterval;
});

afterEach(() => {
  globalThis.setInterval = realSet;
  globalThis.clearInterval = realClear;
});

/** Starting and stopping the timer reads only the limits, so that is all the core carries here. */
function slice(): ClientBudgetsSlice {
  const core = { limits: () => ({}) } as unknown as ClientBudgetsCore;
  return new ClientBudgetsSlice(core);
}

describe("the client budgets' timer", () => {
  test("starting twice leaves one timer, and dispose stops it", () => {
    const budgets = slice();
    budgets.start(1000);
    budgets.start(1000);
    expect(live.size).toBe(1);
    budgets.dispose();
    expect(live.size).toBe(0);
  });
});
