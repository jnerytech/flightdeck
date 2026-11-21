/**
 * Issue #3627: `flightdeckd automation list|runs`, the read side of a project's automations from a
 * terminal. Both ask the daemon for something it already keeps and change nothing. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { listJson, listLines, runsJson, runsLines } from "./domain/automation-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A project (its name or its id) for `list`, an automation id for `runs`. */
export type AutomationCliArgs =
  | { action: "list"; target: string; json?: boolean }
  | { action: "runs"; target: string; limit?: number; json?: boolean };

export function runAutomationCli(
  args: AutomationCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-automation",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      if (args.action === "runs") {
        const { runs } = await daemon.call("automation.runs", {
          id: args.target,
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        });
        return shown(args.json, runsJson(runs), () => runsLines(args.target, runs));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.target);
      if ("refusal" in chosen) return chosen.refusal;
      const { automations } = await daemon.call("automation.list", { projectId: chosen.id });
      return shown(args.json, listJson(automations), () => listLines(chosen.name, automations));
    },
  });
}
