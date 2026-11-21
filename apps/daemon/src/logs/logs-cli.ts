/**
 * Issue #3736: `flightdeckd logs tail`, the last lines of the daemon's own log from a terminal. The daemon redacts
 * and bounds them. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { type LogsCliArgs, tailJson, tailLines } from "./domain/logs-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function runLogsCli(
  args: LogsCliArgs,
  config: { bind: string; port: number; token: string },
  options: { remote?: RemoteTarget; timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-logs",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const tail = await daemon.call(
        "logs.tail",
        args.lines === undefined ? {} : { lines: args.lines },
      );
      return args.json ? json(tailJson(tail)) : said(...tailLines(tail));
    },
  });
}
