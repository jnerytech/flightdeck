/**
 * Issue #3703: `flightdeckd account get|refresh|watch`, the Claude account of a host from a terminal. The host
 * reads it with its own `claude` and never says a token. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  type StreamOptions,
  said,
  streamFrames,
} from "../daemon-client/index.ts";
import { type AccountCliArgs, accountLines, accountWatchLine } from "./domain/account-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface AccountCliOptions extends StreamOptions {
  remote?: RemoteTarget;
  timeoutMs?: number;
}

export async function runAccountCli(
  args: AccountCliArgs,
  config: { bind: string; port: number; token: string },
  options: AccountCliOptions = {},
): Promise<CliResult> {
  const { remote, timeoutMs, ...stream } = options;
  return runOnLocalDaemon({
    config,
    ...(remote ? { remote } : {}),
    clientName: "flightdeck-account",
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon, _note, flow) => {
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          ...stream,
          open: () => daemon.call("account.watch", {}),
          type: "account.updated",
          line: ({ type: _type, ...state }) =>
            args.json ? JSON.stringify(state) : accountWatchLine(state),
        });
      const state = await daemon.call(
        args.action === "get" ? "account.get" : "account.refresh",
        {},
      );
      return args.json ? json(state) : said(...accountLines(state));
    },
  });
}
