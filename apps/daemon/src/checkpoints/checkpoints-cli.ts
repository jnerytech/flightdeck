/**
 * Issue #3701: `flightdeckd snapshots list|files` and `rewind preview|apply|undo`, the git snapshots of a Claude
 * session from a shell. The reads ask the daemon for something it keeps and change nothing; `apply` and `undo`
 * put the files of the checkout back and send `confirm` only after the person typed `--confirm`. Exit codes:
 * 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import {
  rewindPreviewLines,
  rewoundLines,
  snapshotsJson,
  snapshotsLines,
  turnFilesLines,
  undoneLines,
} from "./domain/checkpoints-cli-view.ts";

/** `session` is the Claude session id; `n` and `turn` are the snapshot's number, as `snapshots list` prints it. */
export type CheckpointsCliArgs =
  | { action: "list"; session: string; json?: boolean }
  | { action: "files"; session: string; n: number; json?: boolean }
  | { action: "preview" | "apply"; session: string; turn: number; json?: boolean }
  | { action: "undo"; session: string; json?: boolean };

/** What a write that lost its connection may have done: the person looks before trying again. */
const UNSURE =
  "; the files may or may not have been put back: look at them, or run `rewind undo`, before trying again";

export function runCheckpointsCli(
  args: CheckpointsCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-checkpoints",
    timeoutMs:
      options.timeoutMs ?? (args.action === "apply" || args.action === "undo" ? 60_000 : 15_000),
    unsure: UNSURE,
    perform: async (daemon, note) => {
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
      if (args.action === "apply") {
        note.wrote = true;
        const done = await daemon.call("rewind.apply", {
          claudeSessionId,
          turn: args.turn,
          confirm: true,
        });
        return shown(args.json, done, () => rewoundLines(args.session, args.turn, done));
      }
      if (args.action === "undo") {
        note.wrote = true;
        const done = await daemon.call("rewind.undo", { claudeSessionId, confirm: true });
        return shown(args.json, done, () => undoneLines(args.session, done));
      }
      const preview = await daemon.call("rewind.preview", { claudeSessionId, turn: args.turn });
      return shown(args.json, preview, () => rewindPreviewLines(args.session, args.turn, preview));
    },
  });
}
