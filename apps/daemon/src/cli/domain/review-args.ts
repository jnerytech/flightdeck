/**
 * Issue #3619: `flightdeckd review <verb>`, the inline comments on a diff from a shell. The parser in
 * `args.ts` reads the words after `review` here and this file checks the flags, with the usage text added
 * there; `--json` and `--host` are checked there with the other commands'. `--body` and `--language` are
 * the persona's and the card's too: they are read into the shared fields and only `review` skips their checks.
 */
import type { ReviewCliArgs } from "../../review/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setValue } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";

const REVIEW_ACTIONS = ["list", "add", "update", "remove", "send"] as const;

/** `review list|add|send <target>`, `review update|remove <comment>`. */
export function readReview(args: CliArgs, reader: ArgReader): void {
  args.command = "review";
  const verb = subAction(reader, REVIEW_ACTIONS, "invalid review action");
  args.action = verb;
  if (verb === "update" || verb === "remove") args.reviewComment = operand(reader, "the comment");
  else args.reviewTarget = operand(reader, "the target");
}

const ONLY = "this flag only applies to flightdeckd review";

/** `--lines 7` or `--lines 10-12`: whole numbers from 1, the start first. */
function readLines(v: string): { start: number; end: number } {
  const match = /^(\d+)(?:-(\d+))?$/.exec(v);
  const start = Number(match?.[1]);
  const end = match?.[2] === undefined ? start : Number(match[2]);
  if (!match || ![start, end].every(Number.isSafeInteger) || start < 1 || end < start)
    throw new Error(`--lines: a line (7) or a range from 1 with the start first (10-12)\n${USAGE}`);
  return { start, end };
}

/** The flags of the review verbs; each verb takes its own, checked in `reviewProblem`. */
export const REVIEW_FLAGS: Record<string, Handler> = {
  "--side": setValue((args, v) => {
    if (v !== "new" && v !== "old") throw new Error(`--side: new or old\n${USAGE}`);
    args.reviewSide = v;
  }),
  "--lines": setValue((args, v) => {
    args.reviewLines = readLines(v);
  }),
};

/** What `review add`, `update` and `send` cannot do without, in the order they are read. */
function reviewMissing(args: CliArgs): string | undefined {
  const verb = args.action;
  if (verb === "add") {
    if (args.pathFlag === undefined) return "review add needs --path";
    if (args.reviewLines === undefined) return "review add needs --lines";
  }
  if ((verb === "add" || verb === "update") && args.body === undefined)
    return `review ${verb} needs --body`;
  if ((verb === "add" || verb === "update") && args.body?.trim() === "")
    return "--body: needs text";
  if (verb === "send" && !args.confirm)
    return "--confirm: review send needs it, since it puts the drafts into a session";
  return undefined;
}

/** What is wrong with the review flags and verbs, or undefined; the other commands may not carry them. */
export function reviewProblem(args: CliArgs): string | undefined {
  const verb = args.command === "review" ? args.action : undefined;
  // `--path` is also `agentcfg`'s, which refuses it on the other commands.
  if (args.command === "review" && args.pathFlag !== undefined && verb !== "add")
    return `--path: ${ONLY} add`;
  if (args.reviewSide !== undefined && verb !== "add") return `--side: ${ONLY} add`;
  if (args.reviewLines !== undefined && verb !== "add") return `--lines: ${ONLY} add`;
  if (args.command !== "review") return undefined;
  if (args.body !== undefined && verb !== "add" && verb !== "update")
    return `--body: ${ONLY} add and update`;
  if (args.language !== undefined && verb !== "send") return `--language: ${ONLY} send`;
  if (args.confirm && verb !== "send") return `--confirm: ${ONLY} send`;
  return reviewMissing(args);
}

/** What the review runner takes from the parsed arguments. */
export function reviewCliArgs(args: CliArgs): ReviewCliArgs {
  const json = args.json ? { json: true as const } : {};
  const target = args.reviewTarget ?? "";
  const comment = args.reviewComment ?? "";
  const body = args.body ?? "";
  switch (args.action) {
    case "add":
      return {
        action: "add",
        target,
        path: args.pathFlag ?? "",
        side: args.reviewSide ?? "new",
        lineStart: args.reviewLines?.start ?? 0,
        lineEnd: args.reviewLines?.end ?? 0,
        body,
        ...json,
      };
    case "update":
      return { action: "update", comment, body, ...json };
    case "remove":
      return { action: "remove", comment, ...json };
    case "send":
      return {
        action: "send",
        target,
        ...(args.language ? { language: args.language } : {}),
        ...(args.confirm ? { confirm: true as const } : {}),
        ...json,
      };
    default:
      return { action: "list", target, ...json };
  }
}
