/**
 * Issue #3620: `flightdeckd changes <verb>`, what a session, a card, a terminal or a project changed, from a
 * shell. The parser in `args.ts` reads the words after `changes` here; `--json` and `--host` are checked
 * there with the other commands'.
 */
import { ReviewTarget } from "@flightdeck/protocol";
import type { ChangesCliArgs } from "../../review/index.ts";
import { type ArgReader, invalid, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const CHANGES_ACTIONS = [
  "get",
  "sessions",
  "watch",
  "revert",
  "undo-revert",
  "commit",
  "pr",
] as const;

/** `changes get <target>`, `changes sessions <file>` or `changes watch <target>`. */
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
}

/** What the changes runner takes from the parsed arguments. */
export function changesCliArgs(args: CliArgs): ChangesCliArgs {
  const json = args.json ? { json: true as const } : {};
  const operandOf = args.changesOperand ?? "";
  return args.action === "sessions"
    ? { action: "sessions", path: operandOf, ...json }
    : { action: args.action as "get" | "watch", target: operandOf, ...json };
}
