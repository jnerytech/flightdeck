import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";
import { issuesCliArgs } from "./domain/issues-args.ts";
import { worktreeCliArgs } from "./domain/worktree-args.ts";

type Config = { bind: string; port: number; token: string };

/**
 * What `worktree ...` and `issues ...` run once `asking` has the daemon's config (or the paired host's). Their
 * domains load only when a verb runs: a hook, or a verb of another noun, starts without them (cli-startup test).
 * They live apart from `commands.ts`, which is at the size limit.
 */
export const worktreeRun =
  (args: CliArgs) =>
  async (config: Config, remote?: RemoteTarget): Promise<CliResult> =>
    (await import("../worktrees/index.ts")).runWorktreeCli(
      worktreeCliArgs(args),
      config,
      remote ? { remote } : {},
    );

export const issuesRun =
  (args: CliArgs) =>
  async (config: Config, remote?: RemoteTarget): Promise<CliResult> =>
    (await import("../issues/index.ts")).runIssuesCli(
      issuesCliArgs(args),
      config,
      remote ? { remote } : {},
    );
