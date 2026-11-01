/** The usage indexer's first pass, as `costs.status` reports it. */
export interface UsageLoad {
  state: string;
  filesDone: number;
  filesTotal: number;
}

/**
 * Resolves when the first pass over the transcripts is done, so whoever reads the demo's costs and
 * timing right after the seed finds them in place. A pass that does not end in time is an error
 * that says how far it got, instead of a Custos screen that comes up empty.
 */
export async function waitUsageLoaded(
  status: () => Promise<UsageLoad | null>,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 60_000, pollMs = 50 } = options;
  const deadline = Date.now() + timeoutMs;
  let last: UsageLoad | null = null;
  while (Date.now() < deadline) {
    last = await status();
    if (last?.state === "done") return;
    await Bun.sleep(pollMs);
  }
  throw new Error(
    `the usage's first pass did not end in ${timeoutMs} ms (${JSON.stringify(last)})`,
  );
}
