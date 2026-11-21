/**
 * Issue #3621: `flightdeckd runenv <verb>`, a card's run environment from a shell. The parser in
 * `args.ts` reads the words after `runenv` here; `--json` and `--host` are checked there with the
 * other commands'.
 */
import type { RunenvCliArgs } from "../../runenv/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const RUNENV_ACTIONS = ["config", "get", "watch"] as const;

/** `runenv config <project>`, `runenv get <card>` or `runenv watch`. */
export function readRunenv(args: CliArgs, reader: ArgReader): void {
  args.command = "runenv";
  const verb = subAction(reader, RUNENV_ACTIONS, "invalid runenv action");
  args.action = verb;
  // `watch` carries every card's run: no operand.
  if (verb === "config") args.runenvTarget = operand(reader, "the project");
  if (verb === "get") args.runenvTarget = operand(reader, "the card");
}

/** What the runenv runner takes from the parsed arguments. */
export function runenvCliArgs(args: CliArgs): RunenvCliArgs {
  const json = args.json ? { json: true as const } : {};
  const action = args.action as RunenvCliArgs["action"];
  return action === "watch"
    ? { action, ...json }
    : { action, target: args.runenvTarget ?? "", ...json };
}
