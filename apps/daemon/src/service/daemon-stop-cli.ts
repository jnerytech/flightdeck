/**
 * Issue #3780: `flightdeckd daemon stop --confirm`, the daemon of this machine told to shut down from a shell. The
 * daemon answers the request, then exits, so the answer is the ack and the exit is not waited for. Exit codes: 0
 * asked, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon, shown } from "../daemon-client/index.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

const UNSURE_STOP =
  "; the daemon may or may not have stopped: run `service status`, or any command that asks it, to see";

export async function runDaemonStopCli(
  args: { json?: boolean },
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-daemon-stop",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE_STOP,
    perform: async (daemon, note) => {
      note.wrote = true;
      await daemon.call("daemon.shutdown", { confirm: true });
      return shown(args.json, { stopping: true }, () => ["stopping"]);
    },
  });
}
