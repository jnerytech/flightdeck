/** Issue #3702: what the `worktree` verbs of the CLI take. */
import type { WorktreeCliArgs } from "../../worktrees/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const WORKTREE_ACTIONS = ["list"] as const;

/** `worktree list [<project>]`. */
export function readWorktree(args: CliArgs, reader: ArgReader): void {
  args.command = "worktree";
  args.action = subAction(reader, WORKTREE_ACTIONS, "invalid worktree action");
  const next = reader.peek();
  if (next !== undefined && !next.startsWith("--")) operand(reader, "the project");
}

/** What the worktree runner takes from the parsed arguments. */
export function worktreeCliArgs(args: CliArgs): WorktreeCliArgs {
  return { action: "list", ...(args.json ? { json: true as const } : {}) };
}
