/**
 * Issue #3701: `flightdeckd snapshots list|files` and `rewind preview`, the git snapshots of a Claude session
 * from a shell. Each one asks the daemon for something it keeps and changes nothing. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";

/** `session` is the Claude session id; `n` and `turn` are the snapshot's number, as `snapshots list` prints it. */
export type CheckpointsCliArgs =
  | { action: "list"; session: string; json?: boolean }
  | { action: "files"; session: string; n: number; json?: boolean }
  | { action: "preview"; session: string; turn: number; json?: boolean };

export function runCheckpointsCli(
  _args: CheckpointsCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-checkpoints",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async () => said("not built"),
  });
}
