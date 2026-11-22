/**
 * Issue #3781: `flightdeckd ui set`, the host's default mode and its lock, which the app's setup screen changes
 * too. The daemon of this machine only: a host's presentation is the person's to change from that host, not from
 * another. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { UNSURE, uiJson, uiLine } from "./domain/ui-cli-view.ts";

export interface UiCliArgs {
  action: "set";
  /** Only what the caller gave: the daemon keeps the rest as it is. */
  mode?: "full" | "simple";
  locked?: boolean;
  json?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function runUiCli(
  args: UiCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-ui",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      note.wrote = true;
      const ui = await daemon.call("ui.set", {
        ...(args.mode === undefined ? {} : { mode: args.mode }),
        ...(args.locked === undefined ? {} : { locked: args.locked }),
        confirm: true,
      });
      return shown(args.json, uiJson(ui), (value) => [uiLine(value)]);
    },
  });
}
