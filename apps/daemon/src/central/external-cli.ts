/**
 * Issue #3735: `flightdeckd external list|message|watch`, the sessions of a plain `claude` in a terminal that
 * this host sees. `list` and `watch` ask the daemon for what it already keeps and change nothing; `watch`
 * writes a line each time the daemon pushes a session, until Ctrl-C. `message` puts a text into a session
 * opened with `flightdeckd claude`: the daemon refuses one that does not exist or has no channel. Exit codes:
 * 0 done, 1 refused, 2 no daemon (or no answer: the text may or may not have gone in).
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
  shown,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  externalLine,
  externalLines,
  externalRow,
  sentJson,
  sentLine,
  UNSURE,
} from "./domain/external-cli-view.ts";

export type ExternalCliArgs =
  | { action: "list" | "watch"; json?: boolean }
  | { action: "message"; session: string; text: string; json?: boolean };

const DEFAULT_TIMEOUT_MS = 15_000;

export function runExternalCli(
  args: ExternalCliArgs,
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
    clientName: "flightdeck-external",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action === "message" ? { unsure: UNSURE } : {}),
    perform: async (daemon, note, flow) => {
      if (args.action === "message") {
        note.wrote = true;
        await daemon.call("external.message", { claudeSessionId: args.session, text: args.text });
        return args.json ? json(sentJson(args.session)) : said(sentLine(args.session));
      }
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          signal: options.signal,
          write: options.write,
          open: () => daemon.call("external.watch", {}),
          type: "external.updated",
          line: ({ session }) =>
            args.json ? JSON.stringify(externalRow(session)) : externalLine(session),
        });
      const { sessions } = await daemon.call("external.list", {});
      return shown(args.json, sessions.map(externalRow), () => externalLines(sessions));
    },
  });
}
