import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  type ClientBudgetsCore,
  ClientBudgetsSlice,
} from "../../src/features/costs/client-budgets-store.ts";

/** Moves the clock one interval at a time, letting the round that tick started finish. */
async function tick(times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the client budgets' timer", () => {
  test("starting twice leaves one timer, and dispose stops it", async () => {
    // A round of the timer reads the limits first, so the reads count the rounds that ran.
    let rounds = 0;
    const core = {
      limits: () => {
        rounds += 1;
        return {};
      },
      state: () => ({ clientBudgets: [] }),
    } as unknown as ClientBudgetsCore;
    const budgets = new ClientBudgetsSlice(core);
    rounds = 0; // the constructor reads the limits once, to know what they were

    budgets.start(1000);
    budgets.start(1000);
    await tick(3);
    expect(rounds).toBe(3);

    budgets.dispose();
    await tick(3);
    expect(rounds).toBe(3);
  });
});
