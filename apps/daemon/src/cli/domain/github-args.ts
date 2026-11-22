/**
 * Issue #3703: what `flightdeckd github status|repos|issues|login|logout|start` and `account get|refresh|watch` take,
 * checked before anything is sent. `--json` and `--host` are checked in `args.ts` with the other commands'.
 */
import type { AccountCliArgs } from "../../account/index.ts";
import type { GithubCliArgs } from "../../github/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag, setValue } from "./flag-handlers.ts";

/** The longest `--query` the daemon takes (`github.repos` in the protocol). */
const QUERY_MAX = 100;

const GITHUB_ACTIONS = ["status", "repos", "issues", "login", "logout", "start"] as const;

/** The flags only `github` verbs take (`--mode` is `file search`'s too: its handler is in `file-args.ts`). */
export const GITHUB_FLAGS: Record<string, Handler> = {
  "--issue": setValue((args, value) => {
    args.githubIssue = value;
  }),
  "--cancel": setFlag((args) => {
    args.githubCancel = true;
  }),
};

/** `github status|login|logout`, `github repos [--query <text>]`, `github issues <owner/name>` and `github start <owner/name>`. */
export function readGithub(args: CliArgs, reader: ArgReader): void {
  args.command = "github";
  args.action = subAction(reader, GITHUB_ACTIONS, "invalid github action");
  if (args.action === "issues" || args.action === "start")
    args.githubWords = [operand(reader, "the repository")];
}

/** `account get`, `account refresh` and `account watch`. */
export function readAccount(args: CliArgs, reader: ArgReader): void {
  args.command = "account";
  args.action = subAction(reader, ["get", "refresh", "watch"] as const, "invalid account action");
}

// The daemon's own shape: an owner that starts with a letter or digit, so a name that looks like an option is refused here too.
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WHOLE_NUMBER = /^[1-9]\d*$/;

/** A flag typed on a verb that does not take it, or undefined. */
function strayGithubFlag(args: CliArgs): string | undefined {
  const verb = args.command === "github" ? args.action : undefined;
  const flags: Array<[string, boolean, string]> = [
    ["--query", args.query !== undefined, "repos"],
    ["--root", args.projectRoot !== undefined, "start"],
    ["--mode", args.githubMode !== undefined, "start"],
    ["--issue", args.githubIssue !== undefined, "start"],
    ["--cancel", args.githubCancel === true, "login"],
    ["--confirm", args.confirm !== undefined, "logout"],
  ];
  for (const [flag, typed, owner] of flags)
    if (typed && verb !== owner)
      return `${flag}: this flag only applies to flightdeckd github ${owner}`;
  return undefined;
}

/** What `github start` cannot go without: the folder to clone into and what to open on it. */
function startProblem(args: CliArgs): string | undefined {
  if (!REPOSITORY.test(args.githubWords?.[0] ?? ""))
    return "github start: the repository is owner/name";
  if (args.projectRoot === undefined)
    return "github start: missing --root <folder>, an allowed folder of the host";
  if (args.projectRoot.trim() === "") return "--root: the folder to clone into, not empty";
  if (args.githubMode === undefined) return "github start: missing --mode card or session";
  if (args.githubIssue !== undefined && !WHOLE_NUMBER.test(args.githubIssue))
    return "--issue: the number of the issue, from 1";
  return undefined;
}

/** What is wrong with the `github` and `account` flags: one on a verb that does not take it, or a bad value. */
export function githubProblem(args: CliArgs): string | undefined {
  if (args.command !== "github" && args.command !== "account") return undefined;
  const stray = strayGithubFlag(args);
  if (stray !== undefined) return stray;
  if (args.command === "github" && args.action === "start") return startProblem(args);
  if (args.command === "github" && args.action === "logout" && args.confirm !== true)
    return "github logout: needs --confirm, since it signs the host out of GitHub";
  if (args.query === undefined) return undefined;
  if (args.query.trim() === "") return "--query: the text to look for, not empty";
  if (/\p{Cc}/u.test(args.query)) return "--query: no control character";
  return args.query.length > QUERY_MAX ? `--query: at most ${QUERY_MAX} characters` : undefined;
}

/** What the github runner takes from the parsed arguments. */
export function githubCliArgs(args: CliArgs): GithubCliArgs {
  const json = args.json ? { json: true as const } : {};
  const repo = args.githubWords?.[0] ?? "";
  switch (args.action) {
    case "issues":
      return { action: "issues", repo, ...json };
    case "repos":
      return {
        action: "repos",
        ...(args.query === undefined ? {} : { query: args.query }),
        ...json,
      };
    case "login":
      return { action: "login", ...(args.githubCancel ? { cancel: true as const } : {}), ...json };
    case "logout":
      return { action: "logout", ...json };
    case "start":
      return {
        action: "start",
        repo,
        root: args.projectRoot ?? "",
        mode: args.githubMode ?? "card",
        ...(args.githubIssue === undefined ? {} : { issue: args.githubIssue }),
        ...json,
      };
    default:
      return { action: "status", ...json };
  }
}

/** What the account runner takes from the parsed arguments. */
export function accountCliArgs(args: CliArgs): AccountCliArgs {
  return {
    action: args.action as AccountCliArgs["action"],
    ...(args.json ? { json: true as const } : {}),
  };
}
