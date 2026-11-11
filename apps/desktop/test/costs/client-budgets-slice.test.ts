import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  CLIENT_BUDGET_INTERVAL_MS,
  type ClientBudgetsCore,
  ClientBudgetsSlice,
} from "../../src/features/costs/client-budgets-store.ts";

let budgets: ClientBudgetsSlice | null = null;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  budgets?.dispose();
  budgets = null;
  jest.useRealTimers();
});

describe("the client budgets' timer", () => {
  test("starting twice leaves one timer, which looks at the limits every interval, and dispose stops it", () => {
    // A round starts by reading the limits, so the reads after the constructor count the rounds.
    let reads = 0;
    const core = {
      limits: () => {
        reads += 1;
        return {};
      },
      state: () => ({ clientBudgets: [] }),
    } as unknown as ClientBudgetsCore;
    budgets = new ClientBudgetsSlice(core);
    reads = 0;

    budgets.start();
    budgets.start();
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(CLIENT_BUDGET_INTERVAL_MS - 1);
    expect(reads).toBe(0);
    jest.advanceTimersByTime(1);
    expect(reads).toBe(1);

    budgets.dispose();
    expect(jest.getTimerCount()).toBe(0);
  });
});
