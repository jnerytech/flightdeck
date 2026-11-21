/**
 * Issue #3735: `flightdeckd names list`, the standard names of this host's sessions and the aliases the app
 * addresses them by. It asks the daemon for what it already keeps and changes nothing. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { namesJson, namesLines } from "./domain/names-cli-view.ts";

export interface NamesCliArgs {
  action: "list";
  json?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function runNamesCli(
  args: NamesCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-names",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const { names } = await daemon.call("names.list", {});
      return shown(args.json, namesJson(names), () => namesLines(names));
    },
  });
}
