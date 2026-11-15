/**
 * The quota windows an SDK `rate_limit_info` carries (issue #1601): read defensively, since the
 * CLI sends more than the SDK types say.
 */
import type { QuotaReading } from "../../runtime/index.ts";

const STATUSES: ReadonlySet<string> = new Set(["allowed", "allowed_warning", "rejected"]);

/** One window of a `rate_limit_info` (or the info itself); `null` when it makes no sense. */
function reading(window: string, raw: unknown): QuotaReading | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { status, utilization, resetsAt } = raw as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;
  return {
    window,
    utilization: typeof utilization === "number" ? utilization : null,
    status: status as QuotaReading["status"],
    // Seconds since the epoch on the wire.
    resetsAt: typeof resetsAt === "number" ? resetsAt * 1000 : null,
  };
}

/**
 * The windows of an SDK `rate_limit_info`, read defensively: `unifiedWindows` (not in the SDK
 * types, but sent by the CLI) when present, else the single window at the top.
 */
export function quotaReadings(info: unknown): QuotaReading[] {
  if (typeof info !== "object" || info === null) return [];
  const { unifiedWindows, rateLimitType } = info as Record<string, unknown>;
  let entries: Array<[string, unknown]> = [];
  if (typeof unifiedWindows === "object" && unifiedWindows !== null) {
    entries = Object.entries(unifiedWindows);
  } else if (typeof rateLimitType === "string") {
    entries = [[rateLimitType, info]];
  }
  return entries.flatMap(([window, raw]) => reading(window, raw) ?? []);
}
