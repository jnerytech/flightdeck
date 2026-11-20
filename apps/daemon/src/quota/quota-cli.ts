/**
 * Issue #3460: `flightdeckd quota get|history|pause-at`, the plan quota of a host from a terminal.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  runOnLocalDaemon,
  said,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  DEFAULT_HOURS,
  guardLine,
  historyLines,
  type QuotaCliArgs,
  stateLines,
  UNSURE_PAUSE_AT,
  watchLine,
} from "./domain/quota-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface QuotaCliOptions {
  timeoutMs?: number;
  /** `watch` stops when this aborts (Ctrl-C). */
  signal?: AbortSignal;
  /** `watch` writes each line here as it comes. */
  write?: (line: string) => void;
}

export async function runQuotaCli(
  args: QuotaCliArgs,
  config: { bind: string; port: number; token: string },
  options: QuotaCliOptions = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-quota",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon, note, flow) => {
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          signal: options.signal ?? new AbortController().signal,
          write: options.write ?? (() => undefined),
          open: () => daemon.call("quota.watch", {}),
          type: "quota.updated",
          line: (frame) =>
            args.json
              ? JSON.stringify({ windows: frame.windows, pauseAt: frame.pauseAt })
              : watchLine(frame),
        });
      if (args.action === "get") {
        const state = await daemon.call("quota.get", {});
        return args.json ? json(state) : said(...stateLines(state));
      }
      if (args.action === "history") {
        const history = await daemon.call("quota.history", {
          window: args.window ?? "",
          hours: args.hours ?? DEFAULT_HOURS,
        });
        return args.json ? json(history) : said(...historyLines(history));
      }
      note.wrote = true;
      const state = await daemon.call("quota.setPauseAt", { pauseAt: args.pauseAt ?? null });
      return args.json ? json(state) : said(guardLine(state.pauseAt));
    },
    ...(args.action === "pause-at" ? { unsure: UNSURE_PAUSE_AT } : {}),
  });
}
