/**
 * The unit-test shards of the Windows leg (issue #292), split by measured time instead of by file
 * count: `bun test --shard` hands each shard a third of the files, and the shards then took 9 to 12
 * minutes against 5 to 8. `scripts/test-timings.json` holds the seconds each test file took, and
 * `bun run test:shards -- record <junit.xml>...` refreshes it from the JUnit files a CI run keeps.
 */

/** Seconds per test file, keyed by repository-relative path. */
export type Timings = Record<string, number>;

export interface ShardDeps {
  /** `git <args>` in the repository; null when it fails. */
  git(args: string[]): string | null;
  readTimings(): Timings;
  writeTimings(timings: Timings): void;
  readFile(path: string): string;
  /** Runs `bun <args>` with the terminal; its exit code. */
  bun(args: string[]): Promise<number>;
  log(line: string): void;
  /** The tier of each of these test files (lib/test-tiers.ts); a file no tier claims is absent. */
  tiers(files: string[]): Record<string, string>;
}

/** Names in code-unit order, whatever the locale: the same split on every runner (and what a bare sort() does, said out loud). */
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const TEST_FILE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$/;
const SHARD = /^([1-9]\d*)\/([1-9]\d*)$/;
const USAGE =
  "usage: bun run test:shards -- plan|run <i>/<n> [--junit <file>] | record <junit.xml>...";
const BUN_TEST = ["--config=bunfig.area.toml", "test", "--timeout=15000"];

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

/** `plan`, `run` or `record`; the exit code. */
export async function shards(argv: string[], deps: ShardDeps): Promise<number> {
  const [command, arg, ...rest] = argv;
  const shard = parseShard(arg ?? "");
  const files = () => {
    const listed = deps.git(["ls-files"]);
    return listed === null ? null : testFiles(listed.split("\n").filter(Boolean));
  };
  if (command === "record" && argv.length > 1) {
    const tracked = files();
    if (tracked === null) return failed(deps);
    const fresh: Timings = {};
    for (const path of argv.slice(1)) Object.assign(fresh, parseTimes(deps.readFile(path)));
    const merged = mergeTimings(deps.readTimings(), fresh, tracked);
    deps.writeTimings(merged);
    const timed = tracked.filter((file) => file in fresh).length;
    deps.log(
      `test-shards: ${timed} file(s) timed, ${Object.keys(merged).length} in the timing file`,
    );
    return 0;
  }
  if ((command !== "plan" && command !== "run") || !shard) {
    deps.log(USAGE);
    return 2;
  }
  const tracked = files();
  if (tracked === null) return failed(deps);
  const timings = deps.readTimings();
  const mine = splitShards(tracked, timings, shard.count)[shard.index - 1] ?? [];
  if (command === "plan") {
    for (const file of mine) deps.log(file);
    return 0;
  }
  const seconds = Math.round(total(mine, weigh(tracked, timings)));
  deps.log(`test-shards: shard ${arg}: ${mine.length} files, about ${seconds} s`);
  const at = rest.indexOf("--junit");
  const junit = (at >= 0 ? rest[at + 1] : undefined) ?? `junit-${shard.index}.xml`;
  return await deps.bun([
    ...BUN_TEST,
    "--reporter=junit",
    `--reporter-outfile=${junit}`,
    ...mine.map((file) => `./${file}`),
  ]);
}

function failed(deps: ShardDeps): number {
  deps.log("test-shards: git cannot list the files");
  return 1;
}
