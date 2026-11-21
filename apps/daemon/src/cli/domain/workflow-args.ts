/**
 * Issue #3628: `flightdeckd workflow <verb>`, the workflows of a project and their runs from a shell. The
 * parser in `args.ts` reads the words after `workflow` here; `--json` and `--host` are checked there with the
 * other commands'.
 */
import type { WorkflowCliArgs } from "../../workflows/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const WORKFLOW_ACTIONS = [
  "list",
  "templates",
  "validate",
  "run",
  "watch",
  "resume",
  "trust",
  "template-add",
] as const;

/** The whole sha256 `workflow list` prints: the daemon compares all of it, so a prefix would always read as changed. */
const FULL_HASH = 64;

/**
 * `workflow list|templates <project>`, `workflow validate|trust <project> <workflow>`,
 * `workflow template-add <project> <template>`, `workflow run|resume <run>` or `workflow watch`.
 */
export function readWorkflow(args: CliArgs, reader: ArgReader): void {
  args.command = "workflow";
  const verb = subAction(reader, WORKFLOW_ACTIONS, "invalid workflow action");
  args.action = verb;
  if (verb === "watch") return;
  const words = [operand(reader, verb === "run" || verb === "resume" ? "the run" : "the project")];
  if (verb === "validate" || verb === "trust") words.push(operand(reader, "the workflow"));
  if (verb === "template-add") words.push(operand(reader, "the template"));
  args.workflowWords = words;
}

/**
 * What is wrong with the `workflow` flags: `--hash` goes with `trust` alone, and `--confirm` with the two verbs
 * that change a project or run its commands, `template-add` and `resume`. Both are only the caller's word (#3439).
 */
export function workflowProblem(args: CliArgs): string | undefined {
  if (args.command !== "workflow") return undefined;
  const trust = args.action === "trust";
  if (args.hash !== undefined && !trust)
    return "--hash: this flag only applies to flightdeckd workflow trust";
  if (trust && args.hash === undefined) return "missing --hash";
  if (trust && args.hash?.length !== FULL_HASH)
    return "--hash: the 64 hex characters that workflow list prints";
  if (args.confirm !== undefined && args.action !== "template-add" && args.action !== "resume")
    return "--confirm: this flag only applies to flightdeckd workflow template-add and resume";
  return undefined;
}

/** What the workflow runner takes from the parsed arguments (checked by `readWorkflow`). */
export function workflowCliArgs(args: CliArgs): WorkflowCliArgs {
  const json = args.json ? { json: true as const } : {};
  const [target = "", name = ""] = args.workflowWords ?? [];
  const action = args.action as WorkflowCliArgs["action"];
  if (action === "watch") return { action, ...json };
  const confirm = args.confirm ? { confirm: true as const } : {};
  if (action === "run") return { action, run: target, ...json };
  if (action === "resume") return { action, run: target, ...confirm, ...json };
  if (action === "validate") return { action, project: target, name, ...json };
  if (action === "trust")
    return { action, project: target, name, hash: args.hash as string, ...json };
  if (action === "template-add")
    return { action, project: target, templateId: name, ...confirm, ...json };
  return { action, project: target, ...json };
}
