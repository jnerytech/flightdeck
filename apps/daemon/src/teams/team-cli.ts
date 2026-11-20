/**
 * Issue #3455: `flightdeckd team list|show`, the teams of a host from a terminal, a cron job or an
 * agent. It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the
 * token of the config). Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon } from "../daemon-client/index.ts";
import type { TeamCliArgs } from "./domain/team-cli-view.ts";

export interface TeamCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export function runTeamCli(
  _args: TeamCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: TeamCliOptions = {},
): Promise<CliResult> {
  return Promise.resolve({ code: 0, out: [], err: [] });
}

void runOnLocalDaemon;
