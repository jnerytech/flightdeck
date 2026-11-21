/**
 * Issue #3629: `flightdeckd action list --json|--plain` and `action runs`, the actions of a project and
 * their runs from a terminal, on the CLI-first contract. They ask the daemon for what it already keeps and
 * change nothing. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { listJson, listLines, runsJson, runsLines } from "./domain/action-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** `--project` names a project by its name or id; without it the host's own actions and runs are asked for. */
export type ActionVerbCliArgs =
  | { action: "list"; project?: string; plain?: boolean; json?: boolean }
  | { action: "runs"; project?: string; name?: string; limit?: number; json?: boolean };

type Config = { bind: string; port: number; token: string };

export function runActionVerbCli(
  args: ActionVerbCliArgs,
  config: Config,
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-action",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: "",
    perform: async (daemon) => {
      let scope = {};
      if (args.project !== undefined) {
        const { projects } = await daemon.call("project.list", {});
        const chosen = resolveProject(projects, args.project);
        if ("refusal" in chosen) return chosen.refusal;
        scope = { projectId: chosen.id };
      }
      if (args.action === "runs") {
        const { runs } = await daemon.call("actions.runs", {
          ...scope,
          ...(args.name === undefined ? {} : { name: args.name }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        });
        return shown(args.json, runsJson(runs), () => runsLines(runs));
      }
      const { actions } = await daemon.call("actions.list", scope);
      return shown(args.json, listJson(actions), () => listLines(actions));
    },
  });
}
