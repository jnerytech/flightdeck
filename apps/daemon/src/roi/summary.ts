/**
 * Phase 36: the ROI roll-up. Per project key, for a period and for the same-length period before
 * it: the cost the agents ran up, what was delivered (cards and PRs, planned and unplanned), the
 * rework, the estimated hours and the approvals' waits. Facts only: no rate, price or value.
 */
import type { Database } from "bun:sqlite";
import type { RoiSummaryResult } from "@flightdeck/protocol";

export interface RoiFilter {
  /** First and last day, YYYY-MM-DD, both included. */
  from: string;
  to: string;
  projectKey?: string;
}

export interface RoiSummarizerOptions {
  db: Database;
  /** The project key of a folder; the folder itself when absent. */
  keyOf?: (path: string) => string;
}

export class RoiSummarizer {
  constructor(private readonly opts: RoiSummarizerOptions) {}

  summary(filter: RoiFilter): RoiSummaryResult {
    void this.opts;
    return {
      from: filter.to,
      to: filter.from,
      previousFrom: "",
      previousTo: "",
      projects: [{ projectKey: "", name: "", current: {} as never, previous: {} as never }],
    };
  }
}
