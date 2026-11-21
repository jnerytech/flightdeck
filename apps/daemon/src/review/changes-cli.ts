/**
 * Issue #3620: `flightdeckd changes get|sessions|watch`, the read side of a target's changes from a
 * terminal. `get` and `sessions` ask the daemon for something it already keeps and change nothing; `watch`
 * writes the changes of the target each time the daemon pushes them, until Ctrl-C, which closes the
 * connection and so ends the daemon's watch. `revert`, `undo-revert`, `commit` and `pr` act on the checkout:
 * the parser has already required `--confirm`, so each sends it, and what the person saw (the digests of the
 * files, the remote) is sent as typed: nothing is read again first, or the daemon's check that it moved would
 * check nothing. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  changesJson,
  changesLines,
  changesStreamLine,
  committedLines,
  openedLines,
  restoredLines,
  revertedLines,
  sessionsJson,
  sessionsLines,
  UNSURE,
} from "./domain/changes-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A review target (`session:<id>`, `card:<id>`, `terminal:<id>` or `project:<id>`), or a file's absolute path. */
export type ChangesCliArgs =
  | { action: "get" | "watch"; target: string; json?: boolean }
  | { action: "sessions"; path: string; json?: boolean }
  | { action: "revert" | "undo-revert"; target: string; path: string; json?: boolean }
  | {
      action: "commit";
      target: string;
      branch: string;
      message: string;
      files: Record<string, string>;
      json?: boolean;
    }
  | {
      action: "pr";
      target: string;
      title: string;
      body: string;
      remote: string;
      json?: boolean;
    };

export function runChangesCli(
  args: ChangesCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    remote?: RemoteTarget;
    /** `watch` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `watch` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-changes",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action in UNSURE ? { unsure: UNSURE[args.action as keyof typeof UNSURE] } : {}),
    perform: async (daemon, note, flow) => {
      if (args.action === "sessions") {
        const { sessions } = await daemon.call("files.sessions", { path: args.path });
        return shown(args.json, sessionsJson(sessions), () => sessionsLines(args.path, sessions));
      }
      const { target } = args;
      if (args.action === "revert") {
        const { path } = args;
        note.wrote = true;
        const done = await daemon.call("changes.revert", { target, path, confirm: true });
        return shown(args.json, done, () => revertedLines(target, done));
      }
      if (args.action === "undo-revert") {
        note.wrote = true;
        const done = await daemon.call("changes.undoRevert", {
          target,
          path: args.path,
          confirm: true,
        });
        return shown(args.json, done, () => restoredLines(done));
      }
      if (args.action === "commit") {
        const { files, message, branch } = args;
        note.wrote = true;
        const done = await daemon.call("changes.commit", {
          target,
          files,
          message,
          branch,
          confirm: true,
        });
        return shown(args.json, done, () => committedLines(done));
      }
      if (args.action === "pr") {
        const { title, body, remote } = args;
        note.wrote = true;
        const done = await daemon.call("changes.pr", {
          target,
          title,
          body,
          remote,
          confirm: true,
        });
        return shown(args.json, done, () => openedLines(done));
      }
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          signal: options.signal,
          write: options.write,
          open: () => daemon.call("changes.watch", { target }),
          type: "changes.updated",
          line: (frame) =>
            args.json ? JSON.stringify(changesJson(frame)) : changesStreamLine(frame),
        });
      const result = await daemon.call("changes.get", { target });
      return shown(args.json, changesJson(result), () => changesLines(result));
    },
  });
}
