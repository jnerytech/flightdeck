/**
 * Issue #3620: `flightdeckd changes <verb>`, what a session, a card, a terminal or a project changed, from a
 * shell, and the four writes that act on it (`revert`, `undo-revert`, `commit`, `pr`). The parser in `args.ts`
 * reads the words after `changes` here and this file checks the flags; `--json` and `--host` are checked
 * there with the other commands'. `--message`, `--title`, `--body` and `--confirm` move into fields of their
 * own, so no other command's check reads them.
 */
import { ReviewTarget } from "@flightdeck/protocol";
import type { ChangesCliArgs } from "../../review/index.ts";
import { type ArgReader, invalid, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setValue } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";

const CHANGES_ACTIONS = [
  "get",
  "sessions",
  "watch",
  "revert",
  "undo-revert",
  "commit",
  "pr",
] as const;

/** `changes get|watch|commit|pr <target>`, `changes revert|undo-revert <target> <file>` or `changes sessions <file>`. */
export function readChanges(args: CliArgs, reader: ArgReader): void {
  args.command = "changes";
  const verb = subAction(reader, CHANGES_ACTIONS, "invalid changes action");
  args.action = verb;
  if (verb === "sessions") {
    args.changesOperand = operand(reader, "the file");
    return;
  }
  const target = operand(reader, "the target");
  if (!ReviewTarget.safeParse(target).success) throw invalid("invalid target", target);
  args.changesOperand = target;
  if (verb === "revert" || verb === "undo-revert") args.changesPath = operand(reader, "the file");
}

/** The flags only `changes` verbs take, for the parser's table of flags. */
export const CHANGES_FLAGS: Record<string, Handler> = {
  "--digest": setValue((args, value) => {
    // A path may hold an `=`: the digest is what follows the last one.
    const at = value.lastIndexOf("=");
    if (at < 1 || at === value.length - 1)
      throw new Error(`--digest: expected <path>=<digest>, got ${value}\n${USAGE}`);
    const path = value.slice(0, at);
    const digests = args.changesDigests ?? [];
    if (digests.some(([typed]) => typed === path))
      throw new Error(`--digest: ${path} is given twice\n${USAGE}`);
    args.changesDigests = [...digests, [path, value.slice(at + 1)]];
  }),
  "--branch": setValue((args, value) => {
    args.changesBranch = value;
  }),
  "--remote": setValue((args, value) => {
    args.changesRemote = value;
  }),
};

/** On `changes` the flags the other commands read move into fields of its own (the card's title, the persona's body). */
export function takeChangesFlags(args: CliArgs): void {
  if (args.command !== "changes") return;
  const moved = {
    changesMessage: args.answerMessage,
    changesTitle: args.titleFlag,
    changesBody: args.body,
    changesConfirm: args.confirm,
  };
  for (const [field, value] of Object.entries(moved))
    if (value !== undefined) Object.assign(args, { [field]: value });
  delete args.answerMessage;
  delete args.titleFlag;
  delete args.body;
  delete args.confirm;
}

const WRITES = ["revert", "undo-revert", "commit", "pr"] as const;

/** Each flag, whether it was typed, and the verbs that take it. */
const flagged = (args: CliArgs): Array<[string, boolean, readonly string[]]> => [
  ["--digest", args.changesDigests !== undefined, ["commit"]],
  ["--branch", args.changesBranch !== undefined, ["commit"]],
  ["--message", args.changesMessage !== undefined, ["commit"]],
  ["--remote", args.changesRemote !== undefined, ["pr"]],
  ["--title", args.changesTitle !== undefined, ["pr"]],
  ["--body", args.changesBody !== undefined, ["pr"]],
  ["--confirm", args.changesConfirm !== undefined, WRITES],
];

/** What the verb needs besides its target: the flags with no default, named by the text that says they are missing. */
const needed = (args: CliArgs): Array<[string, unknown]> => {
  if (args.action === "commit")
    return [
      ["--digest", args.changesDigests],
      ["--message", args.changesMessage || undefined],
      ["--branch", args.changesBranch || undefined],
    ];
  if (args.action === "pr")
    return [
      ["--title", args.changesTitle || undefined],
      ["--remote", args.changesRemote || undefined],
    ];
  return [];
};

/** What is wrong with the `changes` flags, or undefined: each flag belongs to its verbs, and a write needs `--confirm`. */
export function changesProblem(args: CliArgs): string | undefined {
  const onChanges = args.command === "changes";
  for (const [flag, typed, verbs] of flagged(args))
    if (typed && !(onChanges && verbs.includes(args.action as string)))
      return `${flag}: this flag only applies to flightdeckd changes ${verbs.join(", ")}`;
  if (!onChanges || !WRITES.includes(args.action as (typeof WRITES)[number])) return undefined;
  if (args.changesConfirm === undefined) return `changes ${args.action} needs --confirm`;
  const missing = needed(args).find(([, value]) => value === undefined);
  return missing ? `changes ${args.action} needs ${missing[0]}` : undefined;
}

/** What the changes runner takes from the parsed arguments. */
export function changesCliArgs(args: CliArgs): ChangesCliArgs {
  const json = args.json ? { json: true as const } : {};
  const operandOf = args.changesOperand ?? "";
  switch (args.action) {
    case "sessions":
      return { action: "sessions", path: operandOf, ...json };
    case "revert":
    case "undo-revert":
      return { action: args.action, target: operandOf, path: args.changesPath ?? "", ...json };
    case "commit":
      return {
        action: "commit",
        target: operandOf,
        branch: args.changesBranch ?? "",
        message: args.changesMessage ?? "",
        // `fromEntries` defines each path as an own key, `__proto__` too.
        files: Object.fromEntries(args.changesDigests ?? []),
        ...json,
      };
    case "pr":
      return {
        action: "pr",
        target: operandOf,
        title: args.changesTitle ?? "",
        body: args.changesBody ?? "",
        remote: args.changesRemote ?? "",
        ...json,
      };
    default:
      return { action: args.action as "get" | "watch", target: operandOf, ...json };
  }
}
