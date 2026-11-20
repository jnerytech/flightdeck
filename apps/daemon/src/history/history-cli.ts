/**
 * Issue #3461: `flightdeckd history list|search|get|tool`, the recorded conversations from a
 * terminal or a script. It speaks to the local daemon like `flightdeckd card` does. Exit codes:
 * 0 done, 1 refused, 2 no daemon. Every verb here only reads.
 */
import { type CliResult, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import type { HistoryCliArgs } from "./domain/history-cli-view.ts";

export async function runHistoryCli(
  _args: HistoryCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-history",
    timeoutMs: options.timeoutMs ?? 30_000,
    unsure: "",
    perform: async () => said(""),
  });
}
