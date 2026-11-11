/** Issue #1949: the engineering metrics snapshot of a release, written by `bun run metrics`. */
import type { LogCommit } from "./git-log.ts";

export interface GitResult {
  code: number;
  stdout: string;
}

export interface MetricsDeps {
  /** Runs `git <args>` in the repository. */
  git(args: string[]): Promise<GitResult>;
  /** The rows of `scripts/arch-report.ts --json`, or null when the report could not be made. */
  arch(): Promise<Array<{ ratchet: string; baseline: number; today: number }> | null>;
  now(): Date;
}

export interface Snapshot {
  schemaVersion: 1;
  tag: string;
  version: string;
  commit: string;
  generatedAt: string;
  window: { previousTag: string | null; previousTagDate: string | null; days: number };
  [metric: string]: unknown;
}

/** The snapshot of the repository at `tag`. */
export async function buildSnapshot(_deps: MetricsDeps, _tag: string): Promise<Snapshot> {
  return {
    schemaVersion: 1,
    tag: "",
    version: "",
    commit: "",
    generatedAt: "",
    window: { previousTag: null, previousTagDate: null, days: 0 },
  };
}

export type { LogCommit };
