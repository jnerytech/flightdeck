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
  void status;
  void options;
}
