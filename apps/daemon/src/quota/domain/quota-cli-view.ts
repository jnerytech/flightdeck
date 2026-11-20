/**
 * Issue #3460: what `flightdeckd quota` says, as pure rules over the answers of the daemon. The
 * daemon calls and the timer stay in `quota/quota-cli.ts`.
 */
import type { QuotaHistory, QuotaState } from "@flightdeck/protocol";

export interface QuotaCliArgs {
  action: "get" | "history" | "pause-at";
  /** `history`: the window (`five_hour`, `seven_day`). */
  window?: string;
  /** `history`: how many hours back; a day when absent. */
  hours?: number;
  /** `pause-at`: a share from 0 to 1; `null` turns the guard off. */
  pauseAt?: number | null;
  json?: boolean;
}

/** What a `pause-at` that got no answer may have done, as the text that follows the message. */
export const UNSURE_PAUSE_AT =
  "; the guard may or may not have changed: check with `quota get` before trying again";

/** How far back `quota history` looks when `--hours` is not given: the window of the app's chart. */
export const DEFAULT_HOURS = 24;

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The guard, as the last line of the state. */
export const guardLine = (pauseAt: number | null) =>
  pauseAt === null ? "the quota guard is off" : `new cards wait from ${percent(pauseAt)}`;

/** One line per window, then the guard. */
export function stateLines(state: QuotaState): string[] {
  const windows = state.windows.map((w) =>
    [
      w.window,
      w.utilization === null ? "unknown" : percent(w.utilization),
      w.status,
      ...(w.resetsAt === null ? [] : [`resets ${w.resetsAt}`]),
    ].join("  "),
  );
  return [...(windows.length === 0 ? ["no quota reading yet"] : windows), guardLine(state.pauseAt)];
}

/** The samples, the projection to 100% (or why there is none) and who spent the window. */
export function historyLines(history: QuotaHistory): string[] {
  const { projection } = history;
  const outlook = !projection
    ? "no projection yet: it needs 3 samples of the window"
    : projection.exhaustsAt === null
      ? "does not reach 100% before it resets"
      : `reaches 100% at ${projection.exhaustsAt}${projection.resetsAt === null ? "" : ` (resets ${projection.resetsAt})`}`;
  return [
    `${history.window}, last ${history.hours} h: ${history.samples.length} samples`,
    outlook,
    ...history.consumers.map(
      (c) => `${c.projectKey}  $${c.costUsd.toFixed(2)}  ${percent(c.share)}`,
    ),
  ];
}
