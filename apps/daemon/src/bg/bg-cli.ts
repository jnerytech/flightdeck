/**
 * Issue #3734: `flightdeckd bg list`, the background sessions (`claude --bg`) of a host from a shell. It asks the
 * daemon for what it reads from `claude agents` and changes nothing. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { bgJson, bgLines } from "./domain/bg-cli-view.ts";

export type BgCliArgs = { action: "list"; json?: boolean };

export function runBgCli(
  args: BgCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-bg",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async (daemon) => {
      const list = await daemon.call("bg.list", {});
      return shown(args.json, bgJson(list), () => bgLines(list));
    },
  });
}
