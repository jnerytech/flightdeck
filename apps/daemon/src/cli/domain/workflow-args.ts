/**
 * Issue #3628: `flightdeckd workflow <verb>`, the workflows of a project and their runs from a shell. The
 * parser in `args.ts` reads the words after `workflow` here; `--json` and `--host` are checked there with the
 * other commands'.
 */
import type { WorkflowCliArgs } from "../../workflows/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const WORKFLOW_ACTIONS = ["list", "templates", "validate", "run", "watch", "resume"] as const;

/**
 * `workflow list|templates <project>`, `workflow validate <project> <workflow>`, `workflow run|resume <run>` or
 * `workflow watch`.
 */
export function readWorkflow(args: CliArgs, reader: ArgReader): void {
  args.command = "workflow";
  const verb = subAction(reader, WORKFLOW_ACTIONS, "invalid workflow action");
  args.action = verb;
  if (verb === "watch") return;
  const words = [operand(reader, verb === "run" || verb === "resume" ? "the run" : "the project")];
  if (verb === "validate") words.push(operand(reader, "the workflow"));
  args.workflowWords = words;
}

/** What is wrong with the `workflow` flags: no verb of this slice changes anything, so none takes `--confirm`. */
export function workflowProblem(args: CliArgs): string | undefined {
  if (args.command !== "workflow") return undefined;
  if (args.confirm !== undefined) return "--confirm: no workflow verb takes it yet";
  return undefined;
}

/** What the workflow runner takes from the parsed arguments (checked by `readWorkflow`). */
export function workflowCliArgs(args: CliArgs): WorkflowCliArgs {
  const json = args.json ? { json: true as const } : {};
  const [target = "", name = ""] = args.workflowWords ?? [];
  const action = args.action as WorkflowCliArgs["action"];
  if (action === "watch") return { action, ...json };
  if (action === "run" || action === "resume") return { action, run: target, ...json };
  if (action === "validate") return { action, project: target, name, ...json };
  return { action, project: target, ...json };
}
