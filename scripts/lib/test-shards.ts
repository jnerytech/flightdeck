/**
 * The unit-test shards of the Windows leg (issue #292), split by measured time instead of by file
 * count: `bun test --shard` hands each shard a third of the files, and the shards then took 9 to 12
 * minutes against 5 to 8. `scripts/test-timings.json` holds the seconds each test file took, and
 * `bun run test:shards -- record <junit.xml>...` refreshes it from the JUnit files a CI run keeps.
 */

import { testArgs } from "../test/timeout.ts";
import { TIERS } from "./test-tiers.ts";

/** Seconds per test file, keyed by repository-relative path. */
export type Timings = Record<string, number>;

export interface ShardDeps {
  /** The platform the shard runs on: it picks the per-test timeout. */
  platform: NodeJS.Platform;
  /** `git <args>` in the repository; null when it fails. */
  git(args: string[]): string | null;
  readTimings(): Timings;
  writeTimings(timings: Timings): void;
  readFile(path: string): string;
  /** Runs `bun <args>` with the terminal; its exit code. */
  bun(args: string[]): Promise<number>;
  log(line: string): void;
  /** The tier of every tracked test file (lib/test-tiers.ts); a file no tier claims is absent. */
  tiers(): Record<string, string>;
}

/** Names in code-unit order, whatever the locale: the same split on every runner (and what a bare sort() does, said out loud). */
const byName = (a: string, b: string) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

const TEST_FILE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$/;
const SHARD = /^([1-9]\d*)\/([1-9]\d*)$/;
const USAGE =
  "usage: bun run test:shards -- plan|run <i>/<n> [--tier <tier>,...] [--files <list>] [--junit <file>] | record <junit.xml>...";
const bunTest = (platform: NodeJS.Platform) => [
  "--config=bunfig.area.toml",
  ...testArgs(platform, []),
];
/**
 * The most characters of file arguments one bun test gets (#483). Windows caps a command line at
 * 32767 characters, and 8191 through a .cmd shim: 1021 files once died with ENAMETOOLONG.
 */
export const ARG_BUDGET = 8000;

/** The files in order, cut into batches whose arguments stay within `ARG_BUDGET` characters. */
export function batches(files: string[], budget = ARG_BUDGET): string[][] {
  const out: string[][] = [];
  let batch: string[] = [];
  let length = 0;
  for (const file of files) {
    const cost = file.length + (batch.length > 0 ? 1 : 0);
    if (batch.length > 0 && length + cost > budget) {
      out.push(batch);
      batch = [];
      length = 0;
    }
    length += file.length + (batch.length > 0 ? 1 : 0);
    batch.push(file);
  }
  if (batch.length > 0) out.push(batch);
  return out;
}

/** The JUnit file of a batch: the given name for the first, `<name>.<n>.xml` for the next ones. */
function batchReport(junit: string, index: number): string {
  return index === 0 ? junit : junit.replace(/(\.xml)?$/, `.${index + 1}$1`);
}

/** The test files `bun test` runs: `*.test.*`, `*_test.*`, `*.spec.*` and `*_spec.*`, never the mods'. */
export function testFiles(tracked: string[]): string[] {
  return tracked.filter((path) => TEST_FILE.test(path) && !path.startsWith("mods/")).sort(byName);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 1)
    : ((sorted[middle - 1] ?? 1) + (sorted[middle] ?? 1)) / 2;
};

/** What a file is expected to take: its recorded time, or the median of the known ones. */
function weigh(files: string[], timings: Timings): Map<string, number> {
  // Only a finite, non-negative number is a time: anything else (a hand-edited file) is unknown, so
  // the file still lands on a shard (a NaN weight would leave it on none).
  const known = (file: string) => {
    const seconds = timings[file];
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? seconds
      : undefined;
  };
  const fallback = median(files.flatMap((file) => known(file) ?? []));
  return new Map(files.map((file) => [file, known(file) ?? fallback]));
}

/** The test files of each of `count` shards: the slowest first, each to the lightest shard so far. */
export function splitShards(files: string[], timings: Timings, count: number): string[][] {
  const weight = weigh(files, timings);
  const split: string[][] = Array.from({ length: count }, () => []);
  const load = new Array<number>(count).fill(0);
  const slowestFirst = [...files].sort(
    (a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || byName(a, b),
  );
  for (const file of slowestFirst) {
    const lightest = load.indexOf(Math.min(...load));
    split[lightest]?.push(file);
    load[lightest] = (load[lightest] ?? 0) + (weight.get(file) ?? 0);
  }
  return split.map((shard) => shard.sort(byName));
}

/** `1/3` as an index (1-based) and a count, or null. */
export function parseShard(text: string): { index: number; count: number } | null {
  const found = SHARD.exec(text);
  if (!found) return null;
  const index = Number(found[1]);
  const count = Number(found[2]);
  return index <= count ? { index, count } : null;
}

/** The seconds of each test file in a JUnit file of `bun test --reporter=junit`. */
export function parseJunit(xml: string): Timings {
  const out: Timings = {};
  for (const tag of xml.matchAll(/<testsuite\s([^>]*)>/g)) {
    const attrs = Object.fromEntries(
      [...(tag[1] ?? "").matchAll(/\b([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    // A file's own suite is named after the file; a describe block carries a line.
    if (attrs.name && attrs.name === attrs.file && !("line" in attrs)) {
      const seconds = Number(attrs.time);
      if (Number.isFinite(seconds)) out[attrs.name] = seconds;
    }
  }
  return out;
}

/**
 * The seconds of each test file in the log of a `bun test` run on CI: the `##[group]<file>:` line
 * opens a file, and the `(pass)`/`(fail)` lines under it carry `[<n>ms]`. Their sum is the file's
 * time; the overhead of loading a file (about 5% of a shard) is left out.
 */
export function parseBunLog(log: string): Timings {
  const out: Timings = {};
  let file: string | undefined;
  for (const raw of log.split("\n")) {
    // GitHub puts a timestamp first; Windows ends the line with a carriage return.
    const line = raw.replace(/\r$/, "").replace(/^\S+Z /, "");
    const opened = /^##\[group\](.+):$/.exec(line);
    if (opened) {
      file = (opened[1] ?? "").replaceAll("\\", "/");
      if (TEST_FILE.test(file)) out[file] = 0;
      else file = undefined;
    } else if (line.startsWith("##[endgroup]")) file = undefined;
    else if (file !== undefined) {
      const ms = /^\((?:pass|fail)\) .* \[([\d.]+)ms\]$/.exec(line)?.[1];
      if (ms !== undefined) out[file] = (out[file] ?? 0) + Number(ms) / 1000;
    }
  }
  return out;
}

/** The timings after a run: its files replace the old ones, the files that are gone drop out. */
export function mergeTimings(old: Timings, fresh: Timings, files: string[]): Timings {
  const out: Timings = {};
  for (const file of [...files].sort(byName)) {
    const seconds = fresh[file] ?? old[file];
    if (seconds !== undefined) out[file] = Math.round(seconds * 1000) / 1000;
  }
  return out;
}

/** A report to learn from: a JUnit file or a `bun test` log. */
const parseTimes = (text: string) =>
  text.includes("<testsuites") ? parseJunit(text) : parseBunLog(text);

const total = (shard: string[], weight: Map<string, number>) =>
  shard.reduce((sum, file) => sum + (weight.get(file) ?? 0), 0);

/**
 * `--tier unit,component` (#309): the tiers to keep, `null` without the flag, `undefined` when the
 * list is missing or names a tier that does not exist.
 */
function tierOption(rest: string[]): string[] | null | undefined {
  const at = rest.indexOf("--tier");
  if (at < 0) return null;
  const asked = (rest[at + 1] ?? "").split(",").filter(Boolean);
  return asked.length > 0 && asked.every((tier) => (TIERS as string[]).includes(tier))
    ? asked
    : undefined;
}

/**
 * `--files <list>` (#399): the test files to keep, one per line, as `test:related --list` writes
 * them; a `*` line keeps every file (the whole suite). `null` without the flag, `undefined` when
 * the list is missing.
 */
function filesOption(rest: string[], deps: ShardDeps): Set<string> | "all" | null | undefined {
  const at = rest.indexOf("--files");
  if (at < 0) return null;
  const path = rest[at + 1];
  if (!path || path.startsWith("--")) return undefined;
  const lines = deps
    .readFile(path)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.includes("*") ? "all" : new Set(lines);
}

/** `plan`, `run` or `record`; the exit code. */
export async function shards(argv: string[], deps: ShardDeps): Promise<number> {
  const [command, arg, ...rest] = argv;
  const shard = parseShard(arg ?? "");
  if (command === "record" && argv.length > 1) return record(argv.slice(1), deps);
  const tiers = tierOption(rest);
  const chosen = filesOption(rest, deps);
  if (
    (command !== "plan" && command !== "run") ||
    !shard ||
    tiers === undefined ||
    chosen === undefined
  ) {
    deps.log(USAGE);
    return 2;
  }
  const listed = trackedTests(deps);
  if (listed === null) return failed(deps);
  const tracked = selected(listed, tiers, chosen, deps);
  if (tracked === null) return 1;
  const timings = deps.readTimings();
  const mine = splitShards(tracked, timings, shard.count)[shard.index - 1] ?? [];
  if (command === "plan") {
    for (const file of mine) deps.log(file);
    return 0;
  }
  const seconds = Math.round(total(mine, weigh(tracked, timings)));
  let which = "";
  if (tiers) which = ` (${tiers.join(",")})`;
  else if (chosen instanceof Set) which = " (selection)";
  deps.log(`test-shards: shard ${arg}${which}: ${mine.length} files, about ${seconds} s`);
  // `bun test` with no file runs everything: a shard the selection leaves empty runs nothing.
  if (mine.length === 0) {
    deps.log(`test-shards: shard ${arg} has no test files to run`);
    return 0;
  }
  const at = rest.indexOf("--junit");
  const junit = (at >= 0 ? rest[at + 1] : undefined) ?? `junit-${shard.index}.xml`;
  return runBatches(mine, { shard: arg ?? "", junit }, deps);
}

/** Every tracked test file, or null when git cannot list the files. */
function trackedTests(deps: ShardDeps): string[] | null {
  const listed = deps.git(["ls-files"]);
  return listed === null ? null : testFiles(listed.split("\n").filter(Boolean));
}

/** `record <junit.xml>...`: the times of these runs go into the timing file. */
function record(reports: string[], deps: ShardDeps): number {
  const tracked = trackedTests(deps);
  if (tracked === null) return failed(deps);
  const fresh: Timings = {};
  for (const path of reports) Object.assign(fresh, parseTimes(deps.readFile(path)));
  const merged = mergeTimings(deps.readTimings(), fresh, tracked);
  deps.writeTimings(merged);
  const timed = tracked.filter((file) => file in fresh).length;
  deps.log(`test-shards: ${timed} file(s) timed, ${Object.keys(merged).length} in the timing file`);
  return 0;
}

/**
 * The tests a run is about: the tiers asked for, and the files of a selection. Null (after saying
 * why) when the selection names a file that is no tracked test.
 */
function selected(
  listed: string[],
  tiers: string[] | null,
  chosen: Set<string> | "all" | null,
  deps: ShardDeps,
): string[] | null {
  // A test no tier claims still runs, never silently dropped (the rule of test:related --tier).
  const tierOf = tiers ? deps.tiers() : {};
  // A listed name that is no tracked test is a stale or mistyped list: fail rather than guess.
  if (chosen instanceof Set) {
    const known = new Set(listed);
    const unknown = [...chosen].filter((file) => !known.has(file));
    if (unknown.length > 0) {
      deps.log(`test-shards: --files names no tracked test file: ${unknown.join(", ")}`);
      return null;
    }
  }
  return listed
    .filter((file) => !tiers || tierOf[file] === undefined || tiers.includes(tierOf[file]))
    .filter((file) => chosen === null || chosen === "all" || chosen.has(file));
}

/** Runs the files in batches of `bun test`; the worst exit code is the run's. */
async function runBatches(
  mine: string[],
  report: { shard: string; junit: string },
  deps: ShardDeps,
): Promise<number> {
  const parts = batches(mine.map((file) => `./${file}`));
  if (parts.length > 1) {
    deps.log(`test-shards: shard ${report.shard} runs in ${parts.length} batches`);
  }
  // Every batch runs, so one failure never hides another; the worst exit code is the run's.
  let worst = 0;
  for (const [index, part] of parts.entries()) {
    const code = await deps.bun([
      ...bunTest(deps.platform),
      "--reporter=junit",
      `--reporter-outfile=${batchReport(report.junit, index)}`,
      ...part,
    ]); // NOSONAR: sequential by design: one bun test at a time on the runner
    worst = Math.max(worst, code);
  }
  return worst;
}

function failed(deps: ShardDeps): number {
  deps.log("test-shards: git cannot list the files");
  return 1;
}
