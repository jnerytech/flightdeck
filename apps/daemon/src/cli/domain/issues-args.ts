/** Issue #3702: what the `issues` verbs of the CLI take. `--json` and `--host` are checked in `args.ts` with the others'. */
import type { IssuesCliArgs } from "../../issues/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const ISSUES_ACTIONS = ["list", "get"] as const;

/** `issues list <project> [--query <text>]` and `issues get <project> <id>`. */
export function readIssues(args: CliArgs, reader: ArgReader): void {
  args.command = "issues";
  args.action = subAction(reader, ISSUES_ACTIONS, "invalid issues action");
  args.issuesProject = operand(reader, "the project");
  if (args.action === "get") args.issuesId = operand(reader, "the issue");
}

/** What is wrong with the `issues` flags: `--query` outside `list`, or an empty one (the daemon takes at least a character). */
export function issuesProblem(args: CliArgs): string | undefined {
  if (args.command !== "issues" || args.query === undefined) return undefined;
  if (args.action !== "list")
    return "--query: on issues this flag only applies to flightdeckd issues list";
  return args.query.trim() === "" ? "--query: the text to look for, not empty" : undefined;
}

/** What the issues runner takes from the parsed arguments. */
export function issuesCliArgs(args: CliArgs): IssuesCliArgs {
  const common = {
    project: args.issuesProject ?? "",
    ...(args.json ? { json: true as const } : {}),
  };
  if (args.action === "get") return { ...common, action: "get", id: args.issuesId ?? "" };
  return { ...common, action: "list", ...(args.query === undefined ? {} : { query: args.query }) };
}
