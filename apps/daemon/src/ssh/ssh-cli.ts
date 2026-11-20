/**
 * Issue #3537: `flightdeckd ssh list|import preview`, the read side of a host's ssh destinations.
 * Neither verb connects or writes: the daemon reads its own list, or `~/.ssh/config`. Exit codes: 0
 * done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { importLines, targetLines } from "./domain/ssh-read-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface SshCliArgs {
  action: "list" | "import-preview";
  json?: boolean;
}

export function runSshCli(
  args: SshCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-ssh",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      if (args.action === "list") {
        const result = await daemon.call("ssh.list", {});
        return args.json ? json(result) : said(...targetLines(result.targets));
      }
      const result = await daemon.call("ssh.import.preview", {});
      return args.json ? json(result) : said(...importLines(result.entries));
    },
  });
}
