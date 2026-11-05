/**
 * A test kept out of the required jobs until it is fixed (issue #288). The test stays intact; the
 * job that runs it changes.
 */
export interface QuarantineEntry {
  /** Repo-relative path of the test file. */
  file: string;
  /** The test's own title (the last part of its name). */
  test: string;
  /** The issue that owns the fix. */
  issue: number;
  /** Why it is quarantined, in one line. */
  reason: string;
}

/** Where the list lives, relative to the repository root. */
export const QUARANTINE_FILE = "scripts/test/quarantine.json";

/** The list, read from the repository. */
export function readQuarantine(_root: string): QuarantineEntry[] {
  return [];
}

/** `text` as a regular expression that matches only itself. */
export function escapeRegExp(text: string): string {
  return text;
}

/** A name pattern that matches every test except the quarantined ones (empty when the list is). */
export function excludePattern(_entries: readonly QuarantineEntry[]): string {
  return "";
}

/** A name pattern that matches only the quarantined tests (empty when the list is). */
export function onlyPattern(_entries: readonly QuarantineEntry[]): string {
  return "";
}

/** The `bun test` arguments that leave the quarantined tests out. */
export function excludeArgs(_entries: readonly QuarantineEntry[]): string[] {
  return [];
}

/** The `bun test` arguments that run only the quarantined tests, and the files they are in. */
export function onlyArgs(_entries: readonly QuarantineEntry[]): string[] {
  return [];
}

/** The `bun` arguments of one Windows shard: the area config, the timeout, the shard, the left-out tests. */
export function shardArgs(
  _platform: NodeJS.Platform,
  _shard: number,
  _entries: readonly QuarantineEntry[],
): string[] {
  return [];
}
