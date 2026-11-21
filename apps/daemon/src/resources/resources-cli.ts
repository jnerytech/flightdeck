/**
 * Issue #3699: `flightdeckd resources`, what the host's work costs it (memory, disk, each session and
 * terminal, the orphans), from a shell. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { resourcesJson, resourcesLines } from "./domain/resources-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ResourcesCliArgs {
  json?: boolean;
}

export async function runResourcesCli(
  args: ResourcesCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-resources",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const snapshot = await daemon.call("resources.get", {});
      return shown(args.json, resourcesJson(snapshot), () => resourcesLines(snapshot));
    },
  });
}
