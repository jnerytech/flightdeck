/**
 * Issue #3460: `flightdeckd costs summary|session|card|run|status|export`, what the host's sessions cost.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import type { CostsCliArgs } from "./domain/costs-cli-view.ts";

export type { CostsCliArgs } from "./domain/costs-cli-view.ts";

export async function runCostsCli(
  _args: CostsCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-costs",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async () => said(),
  });
}
