import type { RoiSummaryResult } from "@flightdeck/protocol";

/** What a host said to `roi.summary`: its figures, or null when it was asked and did not answer. */
export interface RoiAnswer {
  hostId: string;
  result: RoiSummaryResult | null;
}

/** The hosts that gave figures. */
export function answeredHosts(
  all: RoiAnswer[],
): Array<{ hostId: string; result: RoiSummaryResult }> {
  return all.flatMap(({ hostId, result }) => (result ? [{ hostId, result }] : []));
}

/** The hosts that were asked and did not answer. */
export function failedHosts(all: RoiAnswer[]): string[] {
  return all.filter((a) => a.result === null).map((a) => a.hostId);
}
