/** Issue #3702: what the `worktree` verbs of the CLI take. `--json` and `--host` are checked in `args.ts` with the others'. */
import type { WorktreeCliArgs } from "../../worktrees/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const WORKTREE_ACTIONS = ["list", "remove"] as const;

/** `worktree list [<project>]` (without a project, every project of the host) and `worktree remove <project> <path>...`. */
export function readWorktree(args: CliArgs, reader: ArgReader): void {
  args.command = "worktree";
  args.action = subAction(reader, WORKTREE_ACTIONS, "invalid worktree action");
  const next = reader.peek();
  if (args.action === "list" && (next === undefined || next.startsWith("--"))) return;
  args.worktreeProject = operand(reader, "the project");
  if (args.action !== "remove") return;
  const paths: string[] = [];
  while (reader.peek() !== undefined && !(reader.peek() ?? "").startsWith("--")) {
    reader.advance();
    paths.push(reader.current() ?? "");
  }
  args.worktreePaths = paths;
}

/** What is wrong with the `worktree` flags: `--query` (it means nothing here), a remove with no path, or one with no `--confirm`. */
export function worktreeProblem(args: CliArgs): string | undefined {
  if (args.command !== "worktree") return undefined;
  if (args.query !== undefined)
    return "--query: on worktree this flag only applies to flightdeckd issues list";
  if (args.action !== "remove")
    return args.confirm === undefined
      ? undefined
      : "--confirm: on worktree this flag only applies to worktree remove";
  if ((args.worktreePaths ?? []).length === 0)
    return "worktree remove: missing the path of the worktree to remove (see worktree list)";
  if (args.confirm !== true)
    return "worktree remove: needs --confirm, since it deletes the folder of every worktree listed";
  return undefined;
}

/** What the worktree runner takes from the parsed arguments. */
export function worktreeCliArgs(args: CliArgs): WorktreeCliArgs {
  const printed = args.json ? { json: true as const } : {};
  if (args.action === "remove")
    return {
      action: "remove",
      project: args.worktreeProject ?? "",
      paths: args.worktreePaths ?? [],
      confirm: true,
      ...printed,
    };
  return {
    action: "list",
    ...(args.worktreeProject === undefined ? {} : { project: args.worktreeProject }),
    ...printed,
  };
}
