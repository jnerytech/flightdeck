/**
 * Issue #3620: `flightdeckd changes get|sessions|watch`, the read side of a target's changes from a
 * terminal. `get` and `sessions` ask the daemon for something it already keeps and change nothing; `watch`
 * writes the changes of the target each time the daemon pushes them, until Ctrl-C, which closes the
 * connection and so ends the daemon's watch. Exit codes: 0 done, 1 refused, 2 no daemon.
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
  sessionsJson,
  sessionsLines,
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
    perform: async (daemon, _note, flow) => {
      if (args.action === "sessions") {
        const { sessions } = await daemon.call("files.sessions", { path: args.path });
        return shown(args.json, sessionsJson(sessions), () => sessionsLines(args.path, sessions));
      }
      const { target } = args;
      if (args.action !== "get" && args.action !== "watch") return shown(args.json, {}, () => []);
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
