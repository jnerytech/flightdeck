/**
 * Issue #3622: `flightdeckd message history|watch|rules`, the messages between sessions and the rules
 * that govern them, from a terminal or a script. It speaks to the local daemon (or the host `--host`
 * names) like `flightdeckd send` does. Exit codes: 0 done, 1 refused, 2 no daemon. `watch` is a stream
 * (docs/decisions/2026-11-20-cli-streams.md): it runs until Ctrl-C.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  frameLine,
  historyLines,
  listPayload,
  type MessageAdminCliArgs,
  type MessageFrame,
  rulesLines,
  WATCH_FRAMES,
} from "./domain/message-admin-view.ts";

export type { MessageAdminCliArgs } from "./domain/message-admin-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export function runMessageAdminCli(
  args: MessageAdminCliArgs,
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
    clientName: "flightdeck-message",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // Every verb here reads: a silent daemon changed nothing.
    unsure: "",
    perform: async (daemon, _note, flow) => {
      switch (args.action) {
        case "watch":
          return streamFrames({
            daemon,
            flow,
            signal: options.signal ?? new AbortController().signal,
            write: options.write ?? (() => undefined),
            open: () => daemon.call("messages.watch", {}),
            type: WATCH_FRAMES,
            line: (frame) => (args.json ? JSON.stringify(frame) : frameLine(frame as MessageFrame)),
          });
        case "rules": {
          const rules = await daemon.call("messaging.rules.get", {});
          return args.json ? json(rules) : said(...rulesLines(rules));
        }
        case "history": {
          const answer = await daemon.call("messages.list", listPayload(args));
          return args.json ? json(answer) : said(...historyLines(answer.messages));
        }
      }
    },
  });
}
