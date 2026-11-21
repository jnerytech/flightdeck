/** Issue #3755: how `flightdeckd telemetry session|summary` print the timing the daemon holds. */
import type { TelemetrySession, TelemetrySummary } from "@flightdeck/protocol";

/** One block per prompt, with one line per step. */
export function sessionLines(_session: TelemetrySession): string[] {
  return [];
}

/** One block per project: the permission wait and the slowest tools. */
export function summaryLines(_summary: TelemetrySummary): string[] {
  return [];
}
