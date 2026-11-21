/**
 * Issue #3627: `flightdeckd automation <verb>`, the automations of a project from a shell. The parser in
 * `args.ts` reads the words after `automation` here; `--json` and `--host` are checked there with the
 * other commands'. `--limit` is the shared flag: `runs` takes it, and this file holds its upper bound.
 */
import type { AutomationCliArgs } from "../../automations/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const AUTOMATION_ACTIONS = ["list", "runs"] as const;

/** The most runs the daemon returns for one automation (`automation.runs`). */
const MOST_RUNS = 500;

/** `automation list <project>` or `automation runs <automation>`. */
export function readAutomation(args: CliArgs, reader: ArgReader): void {
  args.command = "automation";
  const verb = subAction(reader, AUTOMATION_ACTIONS, "invalid automation action");
  args.action = verb;
  args.automationTarget = operand(reader, verb === "list" ? "the project" : "the automation");
}

/** What is wrong with the automation flags, or undefined: `--limit` belongs to `runs` and stops at the daemon's own bound. */
export function automationProblem(args: CliArgs): string | undefined {
  if (args.command !== "automation" || args.limit === undefined) return undefined;
  if (args.action !== "runs")
    return "--limit: this flag only applies to flightdeckd automation runs";
  return args.limit > MOST_RUNS ? `--limit: at most ${MOST_RUNS}` : undefined;
}

/** What the automation runner takes from the parsed arguments. */
export function automationCliArgs(args: CliArgs): AutomationCliArgs {
  const json = args.json ? { json: true as const } : {};
  const target = args.automationTarget ?? "";
  return args.action === "runs"
    ? {
        action: "runs",
        target,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...json,
      }
    : { action: "list", target, ...json };
}
