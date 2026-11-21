/**
 * Issue #3629: `flightdeckd action list|run|runs`, the words after `action`. `run` and a bare `list` are the
 * `flightdeck` mod's readers and keep printing raw JSON; `list --json`, `list --plain` and `runs` follow the
 * CLI-first contract (`--json`, `--host`, exit codes).
 */
import type { ActionCliArgs, ActionVerbCliArgs } from "../../actions/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag, setValue } from "./flag-handlers.ts";

const ACTION_VERBS = ["list", "run", "runs", "save", "trust", "remove"] as const;

/** `action list`, `action run <name>` or `action runs [<name>]`. */
export function readAction(args: CliArgs, reader: ArgReader): void {
  args.command = "action";
  const verb = subAction(reader, ACTION_VERBS, "invalid action");
  args.action = verb;
  if (verb === "run" || verb === "trust" || verb === "remove")
    args.actionName = operand(reader, "the action name");
  // `runs` may name one action; a word that starts with `-` is the next option.
  const next = reader.peek();
  if (verb === "runs" && next !== undefined && !next.startsWith("-")) {
    reader.advance();
    args.actionName = next;
  }
}

/** The flags of `action`: `--plain` prints lines for a person, `--secret-ids` is the secrets `save` may name. */
export const ACTION_FLAGS: Record<string, Handler> = {
  "--secret-ids": setValue((args, v) => {
    args.secretIds = v.split(",").map((id) => id.trim());
  }),
  "--plain": setFlag((args) => {
    args.plain = true;
  }),
};

const FULL_HASH = 64;

/** The most runs the daemon returns (`actions.runs`). */
const MOST_RUNS = 500;

/** What is wrong with the action flags, or undefined: each flag belongs to its verbs. */
export function actionProblem(args: CliArgs): string | undefined {
  if (args.command !== "action") return undefined;
  const raw = isRawAction(args);
  if (args.plain && args.action !== "list")
    return "--plain: this flag only applies to flightdeckd action list";
  if (args.plain && args.json) return "--plain: not with --json, which is the stable value";
  if (args.limit !== undefined) {
    if (args.action !== "runs") return "--limit: this flag only applies to flightdeckd action runs";
    if (args.limit > MOST_RUNS) return `--limit: at most ${MOST_RUNS}`;
  }
  const written = writeProblem(args);
  if (written !== undefined) return written;
  if (raw && args.json) return "--json: this flag only applies to flightdeckd action list or runs";
  if (raw && args.host !== undefined)
    return "--host: this flag only applies to flightdeckd action list --json or --plain, and runs";
  return undefined;
}

/** The flags of `save` and `trust` belong to those verbs, and each cannot go without what it needs. */
function writeProblem(args: CliArgs): string | undefined {
  const save = args.action === "save";
  const trust = args.action === "trust";
  if (args.definitionFile !== undefined && !save)
    return "--definition-file: this flag only applies to flightdeckd action save";
  if (args.secretIds !== undefined && !save)
    return "--secret-ids: this flag only applies to flightdeckd action save";
  if (args.hash !== undefined && !trust)
    return "--hash: this flag only applies to flightdeckd action trust";
  if (save && args.definitionFile === undefined) return "missing --definition-file";
  if (save && args.secretIds?.some((id) => id.trim() === "") === true)
    return "--secret-ids: a comma-separated list of secret ids";
  if (trust && args.hash === undefined) return "missing --hash";
  // The daemon compares the whole sha256, so a prefix would always read as "the action changed".
  if (trust && args.hash?.length !== FULL_HASH)
    return "--hash: the 64 hex characters that action list --plain prints";
  return undefined;
}

/** True when the line is a raw reader of the mod: `run`, or `list` with neither `--json` nor `--plain`. */
export function isRawAction(args: CliArgs): boolean {
  return args.action === "run" || (args.action === "list" && !args.json && !args.plain);
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
  const json = args.json ? { json: true as const } : {};
  const project = args.project === undefined ? {} : { project: args.project };
  if (args.action === "runs")
    return {
      action: "runs",
      ...project,
      ...(args.actionName === undefined ? {} : { name: args.actionName }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      ...json,
    };
  if (args.action === "save")
    return {
      action: "save",
      ...project,
      definitionFile: args.definitionFile as string,
      ...(args.secretIds === undefined ? {} : { secretIds: args.secretIds }),
      ...json,
    };
  if (args.action === "trust")
    return {
      action: "trust",
      ...project,
      name: args.actionName as string,
      hash: args.hash as string,
      ...json,
    };
  if (args.action === "remove")
    return { action: "remove", ...project, name: args.actionName as string, ...json };
  return { action: "list", ...project, ...(args.plain ? { plain: true as const } : {}), ...json };
}
