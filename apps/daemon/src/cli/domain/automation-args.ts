/**
 * Issue #3627: `flightdeckd automation <verb>`, the automations of a project from a shell. The parser in
 * `args.ts` reads the words after `automation` here; `--json` and `--host` are checked there with the
 * other commands'. `--limit` is the shared flag: `runs` takes it, and this file holds its upper bound.
 * `--name` and `--confirm` are shared too; the flags of `save` are this file's own.
 */
import type { AutomationCliArgs } from "../../automations/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setValue } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";

const AUTOMATION_ACTIONS = ["list", "runs", "save", "enable", "disable", "remove"] as const;

/** The most runs the daemon returns for one automation (`automation.runs`). */
const MOST_RUNS = 500;

/** `automation list|save <project>`, or `automation runs|enable|disable|remove <automation>`. */
export function readAutomation(args: CliArgs, reader: ArgReader): void {
  args.command = "automation";
  const verb = subAction(reader, AUTOMATION_ACTIONS, "invalid automation action");
  args.action = verb;
  const project = verb === "list" || verb === "save";
  args.automationTarget = operand(reader, project ? "the project" : "the automation");
}

/** The flags of `automation save`; the verbs that take each are checked in `automationProblem`. */
export const AUTOMATION_FLAGS: Record<string, Handler> = {
  "--automation": setValue((args, v) => {
    if (v.trim() === "") throw new Error(`--automation: an automation id\n${USAGE}`);
    args.automationId = v;
  }),
  "--max-runs": setValue((args, v) => {
    // Plain decimal digits: `Number` would take `0x5` and `1e3`.
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < 1)
      throw new Error(`--max-runs: a whole number from 1, got ${v}\n${USAGE}`);
    args.maxRuns = Number(v);
  }),
  "--external-authors": setValue((args, v) => {
    if (v !== "on" && v !== "off") throw new Error(`--external-authors: on or off\n${USAGE}`);
    args.externalAuthors = v === "on";
  }),
  "--definition-file": setValue((args, v) => {
    args.definitionFile = v;
  }),
};

/** The flags `save` alone takes, with their names, for the refusal of one on another verb. */
function saveFlags(args: CliArgs): Array<[string, unknown]> {
  return [
    ["--name", args.personaName],
    ["--automation", args.automationId],
    ["--max-runs", args.maxRuns],
    ["--external-authors", args.externalAuthors],
    ["--definition-file", args.definitionFile],
  ];
}

/** The flags a verb does not take: `--limit` is `runs`'s, the save flags are `save`'s. */
function strayFlagProblem(args: CliArgs, verb: string | undefined): string | undefined {
  if (args.limit !== undefined) {
    if (verb !== "runs") return "--limit: this flag only applies to flightdeckd automation runs";
    if (args.limit > MOST_RUNS) return `--limit: at most ${MOST_RUNS}`;
  }
  if (verb === "save") return undefined;
  const stray = saveFlags(args).find(([, value]) => value !== undefined);
  return stray ? `${stray[0]}: this flag only applies to flightdeckd automation save` : undefined;
}

/** What `enable` and `remove` need in `--confirm`, and the verbs that may not carry it. */
function confirmProblem(args: CliArgs, verb: string | undefined): string | undefined {
  const confirms = verb === "enable" || verb === "remove";
  if (args.confirm !== undefined && !confirms)
    return "--confirm: this flag only applies to flightdeckd automation enable or remove";
  if (verb === "enable" && args.confirm === undefined)
    return "automation enable lets the automation fire on its own: pass --confirm";
  if (verb === "remove" && args.confirm === undefined)
    return "automation remove deletes the automation and its runs: pass --confirm";
  return undefined;
}

/** What is wrong with the automation flags, or undefined: each flag belongs to its verbs, and what `save`, `enable` and `remove` cannot do without is named. */
export function automationProblem(args: CliArgs): string | undefined {
  if (args.command !== "automation") return undefined;
  const verb = args.action;
  const found = strayFlagProblem(args, verb) ?? confirmProblem(args, verb);
  if (found !== undefined) return found;
  if (verb === "save" && args.personaName === undefined) return "missing --name";
  if (verb === "save" && args.definitionFile === undefined) return "missing --definition-file";
  return undefined;
}

/** What the automation runner takes from the parsed arguments. */
export function automationCliArgs(args: CliArgs): AutomationCliArgs {
  const json = args.json ? { json: true as const } : {};
  const target = args.automationTarget ?? "";
  switch (args.action) {
    case "runs":
      return {
        action: "runs",
        target,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...json,
      };
    case "save":
      return {
        action: "save",
        target,
        name: args.personaName as string,
        definitionFile: args.definitionFile as string,
        ...(args.automationId === undefined ? {} : { id: args.automationId }),
        ...(args.maxRuns === undefined ? {} : { maxRunsPerDay: args.maxRuns }),
        ...(args.externalAuthors === undefined
          ? {}
          : { allowExternalAuthors: args.externalAuthors }),
        ...json,
      };
    case "enable":
    case "disable":
    case "remove":
      return { action: args.action, target, ...json };
    default:
      return { action: "list", target, ...json };
  }
}
