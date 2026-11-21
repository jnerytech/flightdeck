/**
 * Issue #3702: `flightdeckd worktree list`, the worktrees the app's cleanup screen shows, from a terminal.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, type RemoteTarget, said } from "../daemon-client/index.ts";

export interface WorktreeCliArgs {
  action: "list";
  /** The project, by name or id; without it, every project of the host. */
  project?: string;
  json?: boolean;
}

export async function runWorktreeCli(
  _args: WorktreeCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; remote?: RemoteTarget | undefined } = {},
): Promise<CliResult> {
  return said("");
}
