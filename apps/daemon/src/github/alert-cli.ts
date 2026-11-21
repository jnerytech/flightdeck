/**
 * Issue #3736: `flightdeckd alert list <project>`, the open code-scanning and Dependabot alerts of a project's
 * repository from a terminal. The host reads them with `gh`; nothing here changes an alert. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { type AlertCliArgs, alertJson, alertLines } from "./domain/alert-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export async function runAlertCli(
  args: AlertCliArgs,
  config: { bind: string; port: number; token: string },
  options: { remote?: RemoteTarget; timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-alert",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const { projects } = await daemon.call("project.list", {});
      const found = resolveProject(projects, args.project);
      if ("refusal" in found) return found.refusal;
      const { alerts, unavailable } = await daemon.call("alert.list", { projectId: found.id });
      return args.json
        ? json(alertJson(alerts, unavailable))
        : said(...alertLines(found.name, alerts, unavailable));
    },
  });
}
