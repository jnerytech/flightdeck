/**
 * Issue #3629: `flightdeckd action list|run|runs`, the words after `action`. `run` and a bare `list` are the
 * `flightdeck` mod's readers and keep printing raw JSON; `list --json`, `list --plain` and `runs` follow the
 * CLI-first contract (`--json`, `--host`, exit codes).
 */
import type { ActionCliArgs, ActionVerbCliArgs } from "../../actions/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag } from "./flag-handlers.ts";

const ACTION_VERBS = ["list", "run", "runs"] as const;

/** `action list`, `action run <name>` or `action runs [<name>]`. */
export function readAction(args: CliArgs, reader: ArgReader): void {
  args.command = "action";
  const verb = subAction(reader, ACTION_VERBS, "invalid action");
  args.action = verb;
  if (verb === "run") args.actionName = operand(reader, "the action name");
}

/** The flag of `action list` that prints lines for a person. */
export const ACTION_FLAGS: Record<string, Handler> = {
  "--plain": setFlag(() => {}),
};

/** What is wrong with the action flags, or undefined. */
export function actionProblem(_args: CliArgs): string | undefined {
  return undefined;
}

/** True when the line is a raw reader of the mod: `run`, or `list` with neither `--json` nor `--plain`. */
export function isRawAction(args: CliArgs): boolean {
  return args.action === "run" || (args.action === "list" && !args.json);
}

/** What the legacy runner takes from the parsed arguments. */
export function actionCliArgs(args: CliArgs): ActionCliArgs {
  return {
    action: args.action as "list" | "run",
    project: args.project,
    name: args.actionName,
    params: args.params,
  };
}

/** What the CLI-contract runner takes from the parsed arguments. */
export function actionVerbCliArgs(args: CliArgs): ActionVerbCliArgs {
  return { action: "list", ...(args.json ? { json: true as const } : {}) };
}
