/**
 * Issue #3703: `flightdeckd account get|refresh|watch`, the Claude account of a host from a terminal. The host
 * reads it with its own `claude` and never says a token. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import type { AccountState } from "@flightdeck/protocol";
import {
  type CliResult,
  json,
  plain,
  type RemoteTarget,
  runOnLocalDaemon,
  type StreamOptions,
  said,
  streamFrames,
} from "../daemon-client/index.ts";
import { type AccountCliArgs, accountLines, accountWatchLine } from "./domain/account-cli-view.ts";

/** The host reads the account with its own `claude`, up to 20 s a try and two tries, so a slow read is not "no daemon". */
const DEFAULT_TIMEOUT_MS = 45_000;

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
      const watchLine = (state: AccountState) =>
        args.json ? JSON.stringify(state) : accountWatchLine(state);
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          ...stream,
          // The host pushes nothing until its next read when another watcher is already attached: start with the
          // current state, so the terminal never looks hung.
          open: async () => {
            await daemon.call("account.watch", {});
            stream.write?.(plain(flow.hide(watchLine(await daemon.call("account.get", {})))));
          },
          type: "account.updated",
          line: ({ type: _type, ...state }) => watchLine(state),
        });
      const state = await daemon.call(
        args.action === "get" ? "account.get" : "account.refresh",
        {},
      );
      return args.json ? json(state) : said(...accountLines(state));
    },
  });
}
