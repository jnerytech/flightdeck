/**
 * Issue #3701: `flightdeckd snapshots list|files` and `rewind preview`, the git snapshots of a Claude session
 * from a shell. Each one asks the daemon for something it keeps and changes nothing. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import {
  rewindPreviewLines,
  snapshotsJson,
  snapshotsLines,
  turnFilesLines,
} from "./domain/checkpoints-cli-view.ts";

/** `session` is the Claude session id; `n` and `turn` are the snapshot's number, as `snapshots list` prints it. */
export type CheckpointsCliArgs =
  | { action: "list"; session: string; json?: boolean }
  | { action: "files"; session: string; n: number; json?: boolean }
  | { action: "preview"; session: string; turn: number; json?: boolean };

export function runCheckpointsCli(
  args: CheckpointsCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-checkpoints",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async (daemon) => {
      const claudeSessionId = args.session;
      if (args.action === "list") {
        const { snapshots } = await daemon.call("snapshots.list", { claudeSessionId });
        return shown(args.json, snapshotsJson(snapshots), () =>
          snapshotsLines(args.session, snapshots),
        );
      }
      if (args.action === "files") {
        const files = await daemon.call("snapshots.files", { claudeSessionId, n: args.n });
        return shown(args.json, files, () => turnFilesLines(args.session, args.n, files));
      }
      const preview = await daemon.call("rewind.preview", { claudeSessionId, turn: args.turn });
      return shown(args.json, preview, () => rewindPreviewLines(args.session, args.turn, preview));
    },
  });
}
