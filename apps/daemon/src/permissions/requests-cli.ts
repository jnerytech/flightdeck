/**
 * Issue #3425: `flightdeckd requests [--session <session>] [--json]`, the open permission requests of
 * the local daemon, oldest first. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, said } from "../daemon-client/index.ts";

export interface RequestsCliArgs {
  /** `--session`: only the requests of this session (its id or its name). */
  session?: string;
  json?: boolean;
}

export function runRequestsCli(
  _args: RequestsCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return Promise.resolve(said());
}
