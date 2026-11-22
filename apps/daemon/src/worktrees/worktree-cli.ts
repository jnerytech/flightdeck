/**
 * Issue #3702: `flightdeckd worktree list` and `remove`, the worktrees the app's cleanup screen shows and removes, from
 * a terminal. `remove` deletes folders: the daemon decides, as it does for the app, which ones go (never one with
 * uncommitted work, commits nowhere else, a live session or another branch than the card's), and the answer says
 * which stayed and why. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
  shown,
} from "../daemon-client/index.ts";
import { removeJson, removeLines, worktreeLines } from "./domain/worktree-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export type WorktreeCliArgs = { json?: boolean } & (
  | {
      action: "list";
      /** The project, by name or id; without it, every project of the host. */
      project?: string;
    }
  | {
      action: "remove";
      /** The project, by name or id. */
      project: string;
      /** The folders, as `list` prints them. */
      paths: string[];
      /** The person's yes: the parser refuses a remove without it. */
      confirm: true;
    }
);

const UNSURE =
  "; the folders may or may not have been removed: run `worktree list` before you try again";

export function runWorktreeCli(
  args: WorktreeCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-worktree",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action === "remove" ? { unsure: UNSURE } : {}),
    perform: async (daemon, note) => {
      if (args.action === "remove") {
        const { projects } = await daemon.call("project.list", {});
        const found = resolveProject(projects, args.project);
        if ("refusal" in found) return found.refusal;
        note.wrote = true;
        const result = await daemon.call("worktree.remove", {
          items: args.paths.map((path) => ({ projectId: found.id, path })),
          confirm: args.confirm,
        });
        return args.json ? json(removeJson(result)) : said(...removeLines(result));
      }
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
