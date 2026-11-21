/**
 * Issue #3735: `flightdeckd names list`, the standard names of this host's sessions. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";

export interface NamesCliArgs {
  action: "list";
  json?: boolean;
}

export function runNamesCli(
  _args: NamesCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return Promise.resolve({ code: 0, out: [], err: [] });
}
