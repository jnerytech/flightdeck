/**
 * Issue #3460: `flightdeckd usage`, what a host's managed sessions cost per day and project.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon, said } from "../daemon-client/index.ts";

export interface UsageCliArgs {
  /** How many days back; the daemon's own default when absent. */
  days?: number;
  json?: boolean;
}

export async function runUsageCli(
  _args: UsageCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-usage",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async () => said(),
  });
}
