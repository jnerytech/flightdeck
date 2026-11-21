/**
 * Issue #3629: `flightdeckd action list --json|--plain` and `action runs`, the actions of a project and
 * their runs from a terminal, on the CLI-first contract. They ask the daemon for what it already keeps and
 * change nothing. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, failure, type RemoteTarget } from "../daemon-client/index.ts";

export type ActionVerbCliArgs =
  | { action: "list"; project?: string; plain?: boolean; json?: boolean }
  | { action: "runs"; project?: string; name?: string; limit?: number; json?: boolean };

export function runActionVerbCli(
  _args: ActionVerbCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return Promise.resolve(failure(1, "not yet"));
}
