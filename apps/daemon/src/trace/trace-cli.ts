/**
 * Issue #3701: `flightdeckd trace get|export`, the trace of a Claude session from a shell. Both ask the
 * daemon for something it builds from the transcript and change nothing. Exit codes: 0 done, 1 refused,
 * 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";

export type TraceCliArgs =
  | { action: "get"; session: string; json?: boolean }
  | { action: "export"; session: string; includeContent: boolean; json?: boolean };

export function runTraceCli(
  _args: TraceCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-trace",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async () => said("not built"),
  });
}
