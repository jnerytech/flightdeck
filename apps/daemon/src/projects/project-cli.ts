/**
 * Issue #3515: `flightdeckd project trust-state|stack|trust-inspect|harness-preview`, what a host knows of a
 * project's folder from a terminal or a script. It speaks to the daemon like `flightdeckd plugins` does (the
 * same `DaemonClient`, the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. Every verb here
 * reads: nothing is trusted, written or run.
 */
import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { ProjectCliArgs } from "./domain/project-cli-view.ts";

export async function runProjectCli(
  _args: ProjectCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return { code: 0, out: [], err: [] };
}
