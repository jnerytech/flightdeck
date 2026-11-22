import { formatDecimal, formatDuration } from "../../../i18n/format.ts";
import type { T } from "../../../i18n/index.ts";

/** A tool's or request's time: "150 ms" under a second, "2.9 s" under a minute, else minutes. */
export function formatMs(ms: number, t: T): string {
  if (ms < 1000) return t("telemetry.ms", { n: Math.round(ms) });
  if (ms < 60_000) return t("telemetry.seconds", { n: formatDecimal(ms / 1000, t.lang) });
  return formatDuration(ms, t);
}
