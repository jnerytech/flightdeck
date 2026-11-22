/**
 * Issue #3628: `flightdeckd workflow`, the workflows of a project and their runs from a shell. `list`,
 * `templates` and `validate` read what the base branch holds, `run` one run, `watch` every change of a run and
 * `resume` says whether a failed run can resume. Three verbs write (#3628): `trust` gives a workflow's hash the
 * trust to run its shell commands, `template-add` puts a template on a new branch with a PR, and `resume
 * --confirm` runs a failed run's commands again from its failed step. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type DaemonClient,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  type StreamOptions,
  shown,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  infoLines,
  listLines,
  resumedLines,
  resumeLines,
  runLines,
  templateAddedLines,
  templatesLines,
  UNSURE_WORKFLOW,
  watchLine,
} from "./domain/workflow-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A project is a name or an id; a run is its id. */
export type WorkflowCliArgs =
  | { action: "list" | "templates"; project: string; json?: boolean }
  | { action: "validate"; project: string; name: string; json?: boolean }
  | { action: "trust"; project: string; name: string; hash: string; json?: boolean }
  | { action: "template-add"; project: string; templateId: string; confirm?: true; json?: boolean }
  | { action: "run"; run: string; json?: boolean }
  | { action: "resume"; run: string; confirm?: true; json?: boolean }
  | { action: "watch"; json?: boolean };

export function runWorkflowCli(
  args: WorkflowCliArgs,
  config: { bind: string; port: number; token: string },
  options: StreamOptions & { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-workflow",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action === "trust" || args.action === "template-add" || args.action === "resume"
      ? { unsure: UNSURE_WORKFLOW[args.action] }
      : {}),
    perform: (daemon, note, flow) => {
      if (args.action === "watch") {
        return streamFrames({
          daemon,
          flow,
          ...options,
          open: () => daemon.call("run.watch", {}),
          type: "run.updated",
          line: ({ run }) => (args.json ? JSON.stringify(run) : watchLine(run)),
        });
      }
      return "run" in args ? performRun(args, daemon, note) : performProject(args, daemon, note);
    },
  });
}

type RunArgs = Extract<WorkflowCliArgs, { run: string }>;
type ProjectArgs = Exclude<WorkflowCliArgs, RunArgs | { action: "watch" }>;

/** `run` and `resume` name a run, not a project. */
async function performRun(
  args: RunArgs,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  if (args.action === "resume") {
    if (args.confirm) note.wrote = true;
    const check = await daemon.call("run.resume", {
      runId: args.run,
      ...(args.confirm ? { confirm: true } : {}),
    });
    // A run that cannot resume is refused (exit 1), with the check printed all the same.
    const result = shown(args.json, check, () =>
      args.confirm ? resumedLines(args.run, check) : resumeLines(args.run, check),
    );
    return check.ok ? result : { ...result, code: 1 };
  }
  const run = await daemon.call("run.get", { runId: args.run });
  return shown(args.json, run, () => runLines(run));
}

/** Every other action names a project, a name or an id. */
async function performProject(
  args: ProjectArgs,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  const { projects } = await daemon.call("project.list", {});
  const chosen = resolveProject(projects, args.project);
  if ("refusal" in chosen) return chosen.refusal;
  const projectId = chosen.id;
  if (args.action === "templates") {
    const { templates } = await daemon.call("workflow.templates", { projectId });
    return shown(args.json, { templates }, () => templatesLines(templates));
  }
  if (args.action === "trust") {
    note.wrote = true;
    const info = await daemon.call("workflow.trust", {
      projectId,
      name: args.name,
      hash: args.hash,
    });
    return shown(args.json, info, () => infoLines(info));
  }
  if (args.action === "template-add") {
    // Without --confirm the daemon always refuses, so nothing can have been written.
    if (args.confirm) note.wrote = true;
    const added = await daemon.call("workflow.template.add", {
      projectId,
      templateId: args.templateId,
      ...(args.confirm ? { confirm: true } : {}),
    });
    return shown(args.json, added, () => templateAddedLines(added));
  }
  if (args.action === "validate") {
    const info = await daemon.call("workflow.validate", { projectId, name: args.name });
    return shown(args.json, info, () => infoLines(info));
  }
  const { workflows } = await daemon.call("workflow.list", { projectId });
  return shown(args.json, { workflows }, () => listLines(workflows));
}
