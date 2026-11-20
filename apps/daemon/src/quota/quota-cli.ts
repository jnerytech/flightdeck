/**
 * Issue #3460: `flightdeckd quota get|history|pause-at`, the plan quota of a host from a terminal.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import type { QuotaCliArgs } from "./domain/quota-cli-view.ts";

export interface QuotaCliOptions {
  timeoutMs?: number;
}

export async function runQuotaCli(
  _args: QuotaCliArgs,
  config: { bind: string; port: number; token: string },
  options: QuotaCliOptions = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-quota",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async () => said(),
  });
}
