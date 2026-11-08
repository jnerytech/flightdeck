/** How long a poll waits for its check, and how long it pauses between two looks. */
export interface PollOptions {
  timeoutMs: number;
  pauseMs: number;
}

/** What a check returns while the thing it waits for has not happened yet. */
export type Pending = null | undefined | false;

/** Looks until `check` gives something, pausing between looks; a timeout names what it waited for. */
export async function pollUntil<T>(
  _check: () => T | Pending | Promise<T | Pending>,
  _what: string,
  _options: PollOptions,
): Promise<T> {
  return undefined as T;
}
