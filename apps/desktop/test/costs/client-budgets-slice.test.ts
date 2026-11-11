import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  CLIENT_BUDGET_INTERVAL_MS,
  type ClientBudgetsCore,
  ClientBudgetsSlice,
} from "../../src/features/costs/client-budgets-store.ts";

let budgets: ClientBudgetsSlice | null = null;
/** Reads of the limits since the slice was built: a round of the timer starts by reading them. */
let reads = 0;

beforeEach(() => {
  jest.useFakeTimers();
  const core = {
    limits: () => {
      reads += 1;
      return {};
    },
    state: () => ({ clientBudgets: [] }),
  } as unknown as ClientBudgetsCore;
  budgets = new ClientBudgetsSlice(core);
  reads = 0; // the constructor reads the limits once, to know what they were
});

afterEach(() => {
  budgets?.dispose();
  budgets = null;
  jest.useRealTimers();
});

describe("the client budgets' timer", () => {
  test("starting twice leaves one timer, and dispose stops it", () => {
    budgets?.start();
    budgets?.start();
    budgets?.dispose();
    // A timer left running by either call would look at the limits when its interval ends.
    jest.advanceTimersByTime(3 * CLIENT_BUDGET_INTERVAL_MS);
    expect(reads).toBe(0);
  });

  test("the timer looks at the limits once per interval", () => {
    budgets?.start();
    jest.advanceTimersByTime(CLIENT_BUDGET_INTERVAL_MS - 1);
    expect(reads).toBe(0);
    jest.advanceTimersByTime(1);
    expect(reads).toBe(1);
  });
});
