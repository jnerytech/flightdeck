/**
 * Issue #3460: `flightdeckd budget list|set|set-quota|remove`, the cost limits of a host from a terminal.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import type { BudgetCliArgs } from "./domain/budget-cli-view.ts";

export type { BudgetCliArgs } from "./domain/budget-cli-view.ts";

export async function runBudgetCli(
  _args: BudgetCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-budget",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async () => said(""),
  });
}
