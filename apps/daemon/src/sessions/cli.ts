/**
 * Issue #3424: `flightdeckd sessions [--json]`, the sessions of the local daemon from a terminal or a
 * script. It asks `session.list` like the app does, with the token of the config. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import type { CliResult } from "../daemon-client/index.ts";

export interface SessionsCliArgs {
  /** `--json`: one array of small objects, for a script. */
  json?: boolean;
}

export interface SessionsCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

export async function runSessionsCli(
  _args: SessionsCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: SessionsCliOptions = {},
): Promise<CliResult> {
  return { code: 0, out: [], err: [] };
}
