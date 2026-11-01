/**
 * The waits of the desktop tests. A wait that runs out of time THROWS, with what it waited for
 * (docs/TDD.md): a wait that returns silently makes the next assertion fail far from the cause.
 * `settleMaybe` is for the rare wait whose answer may be "never".
 */
import { act } from "react";

export class WaitTimeout extends Error {
  override name = "WaitTimeout";
}

export type Settle = (check: () => boolean, timeoutMs?: number, label?: string) => Promise<void>;

type Sleep = (ms: number) => Promise<void>;

/** True when `check` held before the deadline. */
async function held(check: () => boolean, timeoutMs: number, sleep: Sleep): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) return false;
    await sleep(10);
  }
  return true;
}

function make(defaultMs: number, sleepOf: () => Promise<Sleep>): Settle {
  return async (check, timeoutMs = defaultMs, label) => {
    if (await held(check, timeoutMs, await sleepOf())) return;
    // What it waited for: the test's label, else the check's own source.
    const what = label ?? check.toString().replace(/\s+/g, " ").trim();
    throw new WaitTimeout(`timeout (${timeoutMs} ms) waiting for: ${what}`);
  };
}

/** The sleep that lets React flush inside `act` (the one of React, which needs no DOM to load). */
const inAct = async (): Promise<Sleep> => (ms) => act(() => Bun.sleep(ms));

/** A `settle` with its own default timeout, inside `act`: each test file keeps the one it had. */
export function waiter(defaultMs: number): Settle {
  return make(defaultMs, inAct);
}

/** The same for tests with no React: plain sleeps. */
export function plainWaiter(defaultMs: number): Settle {
  return make(defaultMs, async () => (ms) => Bun.sleep(ms));
}

export const settle: Settle = waiter(5000);
export const settlePlain: Settle = plainWaiter(5000);

/** The wait that may end without the condition: true when it held, false when time ran out. */
export async function settleMaybe(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  return held(check, timeoutMs, await inAct());
}
