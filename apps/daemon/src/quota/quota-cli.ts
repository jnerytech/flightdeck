/**
 * Issue #3460: `flightdeckd quota get|history|pause-at`, the plan quota of a host from a terminal.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import {
  DEFAULT_HOURS,
  guardLine,
  historyLines,
  type QuotaCliArgs,
  stateLines,
  UNSURE_PAUSE_AT,
} from "./domain/quota-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface QuotaCliOptions {
  timeoutMs?: number;
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
    perform: async (daemon, note) => {
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
