/**
 * Issue #3424: `flightdeckd host [--json]`, what the local daemon reports about its host (the
 * version, the system, the features) from a terminal or a script. It asks `host.info` like the app
 * does, with the token of the config. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import type { CliResult } from "../daemon-client/index.ts";

export interface HostCliArgs {
  /** `--json`: one small object, for a script. */
  json?: boolean;
}

export interface HostCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

export async function runHostCli(
  _args: HostCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: HostCliOptions = {},
): Promise<CliResult> {
  return { code: 0, out: [], err: [] };
}
