/**
 * Issue #3538: `flightdeckd terminal list`, the read side of a host's terminals. It opens, reads and
 * writes none: the daemon answers from the list it keeps. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { terminalLines } from "./domain/terminal-read-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

interface TerminalCliArgs {
  action: "list";
  json?: boolean;
}

export function runTerminalCli(
  args: TerminalCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-terminal",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const result = await daemon.call("terminal.list", {});
      return args.json ? json(result) : said(...terminalLines(result.terminals));
    },
  });
}
