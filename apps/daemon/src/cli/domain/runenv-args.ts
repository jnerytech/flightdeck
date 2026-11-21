/**
 * Issue #3621: `flightdeckd runenv <verb>`, a card's run environment from a shell. The parser in
 * `args.ts` reads the words after `runenv` here; `--json` and `--host` are checked there with the
 * other commands'.
 */
import type { RunenvCliArgs } from "../../runenv/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const RUNENV_ACTIONS = ["config", "get", "watch", "trust", "start", "stop"] as const;

/**
 * `runenv config <project>`, `runenv trust <project> --hash <hash> --confirm`, `runenv get|start|stop <card>`
 * or `runenv watch`. `start` takes `--confirm` too: it runs the commands of the project's run.yaml.
 */
export function readRunenv(args: CliArgs, reader: ArgReader): void {
  args.command = "runenv";
  const verb = subAction(reader, RUNENV_ACTIONS, "invalid runenv action");
  args.action = verb;
  // `watch` carries every card's run: no operand.
  if (verb === "config" || verb === "trust") args.runenvTarget = operand(reader, "the project");
  if (verb === "get" || verb === "start" || verb === "stop")
    args.runenvTarget = operand(reader, "the card");
}

const FULL_HASH = 64;

/** What is wrong with the runenv flags, or undefined: `--hash` and `--confirm` each belong to their verbs. */
export function runenvProblem(args: CliArgs): string | undefined {
  if (args.command !== "runenv") return undefined;
  const trust = args.action === "trust";
  const start = args.action === "start";
  if (args.confirm !== undefined && !trust && !start)
    return "--confirm: this flag only applies to flightdeckd runenv trust or start";
  if (args.hash !== undefined && !trust)
    return "--hash: this flag only applies to flightdeckd runenv trust";
  if (trust && args.hash === undefined) return "missing --hash";
  // The daemon compares the whole sha256, so a prefix would always read as "the run.yaml changed".
  if (trust && args.hash?.length !== FULL_HASH)
    return "--hash: the 64 hex characters that runenv config prints";
  if (trust && args.confirm === undefined)
    return "runenv trust lets the project's run.yaml run: pass --confirm";
  if (start && args.confirm === undefined)
    return "runenv start runs the commands of the project's run.yaml: pass --confirm";
  return undefined;
}

/** What the runenv runner takes from the parsed arguments. */
export function runenvCliArgs(args: CliArgs): RunenvCliArgs {
  const json = args.json ? { json: true as const } : {};
  const target = args.runenvTarget ?? "";
  switch (args.action) {
    case "watch":
      return { action: "watch", ...json };
    case "trust":
      return { action: "trust", target, hash: args.hash as string, ...json };
    default:
      return { action: args.action as "config" | "get" | "start" | "stop", target, ...json };
  }
}
