/**
 * Issue #3702: `flightdeckd issues list|get`, a project's tracker issues from a terminal.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, type RemoteTarget, said } from "../daemon-client/index.ts";

export type IssuesCliArgs = { project: string; json?: boolean } & (
  | { action: "list"; query?: string }
  | { action: "get"; id: string }
);

export async function runIssuesCli(
  _args: IssuesCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; remote?: RemoteTarget | undefined } = {},
): Promise<CliResult> {
  return said("");
}
