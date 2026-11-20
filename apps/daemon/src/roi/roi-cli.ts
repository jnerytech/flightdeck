/**
 * Issue #3460: `flightdeckd roi`, what the agents cost and delivered in a period against the one before.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon, said } from "../daemon-client/index.ts";

export interface RoiCliArgs {
  from: string;
  to: string;
  projectKey?: string;
  json?: boolean;
}

export async function runRoiCli(
  _args: RoiCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-roi",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async () => said(),
  });
}
