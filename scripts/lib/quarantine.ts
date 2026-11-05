import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testArgs } from "../test/timeout.ts";

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
export function readQuarantine(root: string): QuarantineEntry[] {
  const list: unknown = JSON.parse(readFileSync(join(root, QUARANTINE_FILE), "utf8"));
  if (!Array.isArray(list)) throw new Error(`${QUARANTINE_FILE}: expected a list of entries`);
  return list.map((item: Partial<QuarantineEntry>, i) => {
    const { file, test, issue, reason } = item;
    if (typeof file !== "string" || typeof test !== "string") {
      throw new Error(`${QUARANTINE_FILE}[${i}]: file and test are strings`);
    }
    if (typeof issue !== "number" || typeof reason !== "string") {
      throw new Error(`${QUARANTINE_FILE}[${i}]: issue is a number and reason a string`);
    }
    return { file, test, issue, reason };
  });
}

/** `text` as a regular expression that matches only itself. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** The titles as one alternative group; a test's name ends with its title, whatever suite holds it. */
function titles(entries: readonly QuarantineEntry[]): string {
  return `(?:${entries.map((e) => escapeRegExp(e.test)).join("|")})$`;
}

/** A name pattern that matches every test except the quarantined ones (empty when the list is). */
export function excludePattern(entries: readonly QuarantineEntry[]): string {
  return entries.length === 0 ? "" : `^(?!.*${titles(entries)}).*`;
}

/** A name pattern that matches only the quarantined tests (empty when the list is). */
export function onlyPattern(entries: readonly QuarantineEntry[]): string {
  return entries.length === 0 ? "" : titles(entries);
}

/** The `bun test` arguments that leave the quarantined tests out. */
export function excludeArgs(entries: readonly QuarantineEntry[]): string[] {
  return entries.length === 0 ? [] : ["--test-name-pattern", excludePattern(entries)];
}

/** The `bun test` arguments that run only the quarantined tests, and the files they are in. */
export function onlyArgs(entries: readonly QuarantineEntry[]): string[] {
  if (entries.length === 0) return [];
  const files = [...new Set(entries.map((e) => e.file))];
  return ["--test-name-pattern", onlyPattern(entries), ...files];
}

/** The `bun` arguments of one Windows shard: the area config, the timeout, the shard, the left-out tests. */
export function shardArgs(
  platform: NodeJS.Platform,
  shard: number,
  entries: readonly QuarantineEntry[],
): string[] {
  return [
    "--config=bunfig.area.toml",
    ...testArgs(platform, [`--shard=${shard}/3`, ...excludeArgs(entries)]),
  ];
}
