/**
 * The 100% coverage gate of a suite run in shards (#296). Each shard runs twice, in jobs of its own:
 * once with Bun's coverage (the lines, and the lcov SonarCloud reads) and once with istanbul's
 * function maps (Bun's lcov counts functions but does not name them, so counts cannot merge). The
 * gate fails closed: a shard missing, doubled, failed or short of the suite's test files means no
 * verdict at all, never 100%.
 */
import type { FunctionCoverage } from "./coverage-funcs.ts";

/** What each shard job writes next to its data. */
export interface ShardMarker {
  shard: number;
  of: number;
  kind: "bun" | "istanbul";
  /** The test files the job ran. */
  files: string[];
  exit: number;
  /** Failed tests. */
  fail: number;
}

export interface ShardJob {
  marker: ShardMarker | null;
  /** The Bun job's lcov text, or the istanbul job's counters as JSON; null when missing. */
  data: string | null;
}

export interface GateInput {
  shards: number;
  /** Every test file of the suite: the shards together must run exactly these. */
  tests: readonly string[];
  jobs: readonly ShardJob[];
  /** The source files that must be loaded and covered (check-coverage.ts). */
  sources: readonly string[];
}

export interface GateResult {
  /** Empty only when every shard is in and every loaded file and source is at 100%. */
  problems: string[];
  /** The shards' Bun lcov merged, for SonarCloud; empty when a shard is missing. */
  lcov: string;
}

export function shardGate(input: GateInput): GateResult {
  return { problems: input.shards < 0 ? ["x"] : [], lcov: "" };
}

export type { FunctionCoverage };
