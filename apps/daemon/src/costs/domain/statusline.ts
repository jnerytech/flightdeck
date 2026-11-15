import type { Quota } from "../../quota/index.ts";
import type { Costs } from "../costs.ts";

/** What `statusline.get` gives: the quota windows, today's cost and the session's. */
export interface StatuslineData {
  windows: Array<{ window: string; utilization: number | null }>;
  todayUsd: number;
  /** `null` without a session id, or for a session without usage. */
  sessionUsd: number | null;
}

/** How long `flightdeckd statusline` waits for everything, stdin included: 250 ms, so the line is out in under the 300 ms of the spec. */
export const STATUSLINE_TIMEOUT_MS = 250;

const LABELS: Record<string, string> = { five_hour: "5h", seven_day: "7d" };

/** The data of the status line, from the host's quota and costs. */
export function statuslineData(opts: {
  quota?: Quota;
  costs?: Costs;
  today: string;
  claudeSessionId?: string;
}): StatuslineData {
  const windows = (opts.quota?.state().windows ?? []).map((w) => ({
    window: w.window,
    utilization: w.utilization,
  }));
  const today = opts.costs?.summary({ from: opts.today, to: opts.today }).totals.costUsd ?? 0;
  const session =
    opts.claudeSessionId && opts.costs ? opts.costs.session(opts.claudeSessionId) : null;
  return {
    windows,
    todayUsd: today,
    sessionUsd: session && session.tokens > 0 ? session.costUsd : null,
  };
}

/** `5h 35% · 7d 27% · hoje $4.20 · sessão $0.84`. */
export function statuslineText(data: StatuslineData): string {
  const parts = data.windows
    .filter((w) => w.utilization !== null)
    .map((w) => `${LABELS[w.window] ?? w.window} ${Math.round((w.utilization as number) * 100)}%`);
  parts.push(`hoje $${data.todayUsd.toFixed(2)}`);
  if (data.sessionUsd !== null) parts.push(`sessão $${data.sessionUsd.toFixed(2)}`);
  return parts.join(" · ");
}
