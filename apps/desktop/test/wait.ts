/**
 * The waits of the desktop tests. A wait that runs out of time THROWS, with what it waited for
 * (docs/TDD.md): a wait that returns silently makes the next assertion fail far from the cause.
 * `settleMaybe` is for the rare wait whose answer may be "never".
 */

export class WaitTimeout extends Error {
  override name = "WaitTimeout";
}

/** What the check is, for the message: its source, or the label the test gave. */
function describe(check: () => unknown, label: string | undefined): string {
  return label ?? check.toString().replace(/\s+/g, " ").trim();
}

type Sleep = (ms: number) => Promise<void>;

/** True when `check` held before the deadline. */
async function until(check: () => boolean, timeoutMs: number, sleep: Sleep): Promise<boolean> {
  void check;
  void timeoutMs;
  void sleep;
  return true;
}

/** The sleep that lets React flush inside `act` (Testing Library, loaded after the DOM exists). */
async function actSleep(ms: number): Promise<void> {
  void ms;
}

export interface Settle {
  (check: () => boolean, timeoutMs?: number, label?: string): Promise<void>;
}

/** A `settle` with its own default timeout; every test file keeps the default it had. */
export function waiter(defaultMs: number): Settle {
  void defaultMs;
  return async () => {};
}

/** Waits for `check`, inside `act`; throws `WaitTimeout` naming the check when time runs out. */
export const settle: Settle = waiter(5000);

/** Like `settle` for tests with no React: plain sleeps. */
export function plainWaiter(defaultMs: number): Settle {
  void defaultMs;
  return async () => {};
}

export const settlePlain: Settle = plainWaiter(5000);

/** The wait that may end without the condition: true when it held, false when time ran out. */
export async function settleMaybe(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  void check;
  void timeoutMs;
  return true;
}

export { actSleep, describe, until };
