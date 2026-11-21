/**
 * Issue #3628: `flightdeckd workflow`, the workflows of a project and their runs from a shell. `list`,
 * `templates` and `validate` read what the base branch holds, `run` one run, `watch` every change of a run and
 * `resume` says whether a failed run can resume. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
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
  resumeLines,
  runLines,
  templatesLines,
  watchLine,
} from "./domain/workflow-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A project is a name or an id; a run is its id. */
export type WorkflowCliArgs =
  | { action: "list" | "templates"; project: string; json?: boolean }
  | { action: "validate"; project: string; name: string; json?: boolean }
  | { action: "run" | "resume"; run: string; json?: boolean }
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
    perform: async (daemon, _note, flow) => {
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          ...options,
          open: () => daemon.call("run.watch", {}),
          type: "run.updated",
          line: ({ run }) => (args.json ? JSON.stringify(run) : watchLine(run)),
        });
      if ("run" in args) {
        if (args.action === "resume") {
          const check = await daemon.call("run.resume", { runId: args.run });
          return shown(args.json, check, () => resumeLines(args.run, check));
        }
        const run = await daemon.call("run.get", { runId: args.run });
        return shown(args.json, run, () => runLines(run));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.project);
      if ("refusal" in chosen) return chosen.refusal;
      const projectId = chosen.id;
      if (args.action === "templates") {
        const { templates } = await daemon.call("workflow.templates", { projectId });
        return shown(args.json, { templates }, () => templatesLines(templates));
      }
      if (args.action === "validate") {
        const info = await daemon.call("workflow.validate", { projectId, name: args.name });
        return shown(args.json, info, () => infoLines(info));
      }
      const { workflows } = await daemon.call("workflow.list", { projectId });
      return shown(args.json, { workflows }, () => listLines(workflows));
    },
  });
}
