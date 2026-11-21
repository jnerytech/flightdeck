/** Issue #3702: what the `issues` verbs of the CLI take. */
import type { IssuesCliArgs } from "../../issues/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const ISSUES_ACTIONS = ["list", "get"] as const;

/** `issues list <project> [--query <text>]` and `issues get <project> <id>`. */
export function readIssues(args: CliArgs, reader: ArgReader): void {
  args.command = "issues";
  args.action = subAction(reader, ISSUES_ACTIONS, "invalid issues action");
  operand(reader, "the project");
  if (args.action === "get") operand(reader, "the issue");
}

/** What the issues runner takes from the parsed arguments. */
export function issuesCliArgs(args: CliArgs): IssuesCliArgs {
  return { action: "list", project: "", ...(args.json ? { json: true as const } : {}) };
}

/** What is wrong with the `issues` flags. */
export function issuesProblem(_args: CliArgs): string | undefined {
  return undefined;
}
