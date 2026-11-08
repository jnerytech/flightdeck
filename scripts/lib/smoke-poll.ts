/** How long a poll waits for its check, and how long it pauses between two looks. */
export interface PollOptions {
  timeoutMs: number;
  pauseMs: number;
}

/** What a check returns while the thing it waits for has not happened yet. */
export type Pending = null | undefined | false;

/** Looks until `check` gives something, pausing between looks; a timeout names what it waited for. */
export async function pollUntil<T>(
  check: () => T | Pending | Promise<T | Pending>,
  what: string,
  options: PollOptions,
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(options.pauseMs); // NOSONAR: a poll, one look per pause
  }
}
