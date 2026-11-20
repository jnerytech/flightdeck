/**
 * Issue #3539: `flightdeckd watch <verb>`, a card's PR watch from a shell. The parser in `args.ts` reads
 * the words after `watch` here; `--json` and `--host` are checked there with the other commands'.
 */
import type { WatchCliArgs } from "../../watch/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const WATCH_ACTIONS = ["get", "trace", "describe", "by-url", "settings"] as const;

/** What the operand of each verb is called in a refusal. */
const OPERANDS = {
  get: "the card",
  trace: "the card",
  describe: "the card",
  "by-url": "the PR link",
  settings: "the project",
} as const;

/** `watch get|trace|describe <card>`, `watch by-url <link>` or `watch settings <project>`. */
export function readWatch(args: CliArgs, reader: ArgReader): void {
  args.command = "watch";
  const verb = subAction(reader, WATCH_ACTIONS, "invalid watch action");
  args.action = verb;
  args.watchTarget = operand(reader, OPERANDS[verb]);
}

export function watchCliArgs(args: CliArgs): WatchCliArgs {
  return {
    action: args.action as WatchCliArgs["action"],
    target: args.watchTarget ?? "",
    ...(args.json ? { json: true } : {}),
  };
}
