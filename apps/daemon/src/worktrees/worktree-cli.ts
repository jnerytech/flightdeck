/**
 * Issue #3702: `flightdeckd worktree list`, the worktrees the app's cleanup screen shows, from a terminal.
 * It changes nothing. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { worktreeLines } from "./domain/worktree-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface WorktreeCliArgs {
  action: "list";
  /** The project, by name or id; without it, every project of the host. */
  project?: string;
  json?: boolean;
}

export function runWorktreeCli(
  args: WorktreeCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget | undefined } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-worktree",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      let payload: { projectId?: string } = {};
      if (args.project !== undefined) {
        const { projects } = await daemon.call("project.list", {});
        const found = resolveProject(projects, args.project);
        if ("refusal" in found) return found.refusal;
        payload = { projectId: found.id };
      }
      return shown(args.json, await daemon.call("worktree.list", payload), worktreeLines);
    },
  });
}
