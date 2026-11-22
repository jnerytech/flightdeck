/**
 * Issue #3703: what `flightdeckd github status|repos|issues` and `account get|refresh|watch` take, checked before
 * anything is sent. `--json` and `--host` are checked in `args.ts` with the other commands'.
 */
import type { AccountCliArgs } from "../../account/index.ts";
import type { GithubCliArgs } from "../../github/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

/** The longest `--query` the daemon takes (`github.repos` in the protocol). */
const QUERY_MAX = 100;

/** `github status`, `github repos [--query <text>]` and `github issues <owner/name>`. */
export function readGithub(args: CliArgs, reader: ArgReader): void {
  args.command = "github";
  args.action = subAction(reader, ["status", "repos", "issues"] as const, "invalid github action");
  if (args.action === "issues") args.githubWords = [operand(reader, "the repository")];
}

/** `account get`, `account refresh` and `account watch`. */
export function readAccount(args: CliArgs, reader: ArgReader): void {
  args.command = "account";
  args.action = subAction(reader, ["get", "refresh", "watch"] as const, "invalid account action");
}

/** What is wrong with the `github` and `account` flags: `--query` outside `github repos`, or a bad one. */
export function githubProblem(args: CliArgs): string | undefined {
  if ((args.command !== "github" && args.command !== "account") || args.query === undefined)
    return undefined;
  if (args.command !== "github" || args.action !== "repos")
    return "--query: this flag only applies to flightdeckd github repos";
  if (args.query.trim() === "") return "--query: the text to look for, not empty";
  if (/\p{Cc}/u.test(args.query)) return "--query: no control character";
  return args.query.length > QUERY_MAX ? `--query: at most ${QUERY_MAX} characters` : undefined;
}

/** What the github runner takes from the parsed arguments. */
export function githubCliArgs(args: CliArgs): GithubCliArgs {
  const json = args.json ? { json: true as const } : {};
  if (args.action === "issues")
    return { action: "issues", repo: args.githubWords?.[0] ?? "", ...json };
  if (args.action === "repos")
    return { action: "repos", ...(args.query === undefined ? {} : { query: args.query }), ...json };
  return { action: "status", ...json };
}

/** What the account runner takes from the parsed arguments. */
export function accountCliArgs(args: CliArgs): AccountCliArgs {
  return {
    action: args.action as AccountCliArgs["action"],
    ...(args.json ? { json: true as const } : {}),
  };
}
