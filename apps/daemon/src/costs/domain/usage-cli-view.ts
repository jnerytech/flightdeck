/** Issue #3460: what `flightdeckd usage` says, as pure rules over the daemon's answer. */
import type { UsageSummary } from "@flightdeck/protocol";

export interface UsageCliArgs {
  /** How many days back; the daemon's own default when absent. */
  days?: number;
  json?: boolean;
}

export function usageLines(summary: UsageSummary): string[] {
  return [
    `last ${summary.days} days`,
    ...(summary.rows.length === 0
      ? ["no usage in that time"]
      : summary.rows.map(
          (r) =>
            `${r.day}  ${r.projectKey}  $${r.costUsd.toFixed(2)}  ${r.inputTokens} in, ${r.outputTokens} out  ${r.turns} turns`,
        )),
  ];
}
