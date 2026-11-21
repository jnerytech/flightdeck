/** Issue #3702: what the `worktree` verbs of the CLI take. `--json` and `--host` are checked in `args.ts` with the others'. */
import type { WorktreeCliArgs } from "../../worktrees/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const WORKTREE_ACTIONS = ["list"] as const;

/** `worktree list [<project>]`: without a project, every project of the host. */
export function readWorktree(args: CliArgs, reader: ArgReader): void {
  args.command = "worktree";
  args.action = subAction(reader, WORKTREE_ACTIONS, "invalid worktree action");
  const next = reader.peek();
  if (next !== undefined && !next.startsWith("--"))
    args.worktreeProject = operand(reader, "the project");
}

/** `--query` is shared with other nouns and means nothing to `worktree list`: refuse it, not ignore it. */
export function worktreeProblem(args: CliArgs): string | undefined {
  return args.command === "worktree" && args.query !== undefined
    ? "--query: on worktree this flag only applies to flightdeckd issues list"
    : undefined;
}

/** What the worktree runner takes from the parsed arguments. */
export function worktreeCliArgs(args: CliArgs): WorktreeCliArgs {
  return {
    action: "list",
    ...(args.worktreeProject === undefined ? {} : { project: args.worktreeProject }),
    ...(args.json ? { json: true as const } : {}),
  };
}
