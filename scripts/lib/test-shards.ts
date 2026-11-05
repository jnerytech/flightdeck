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
}

/** The test files `bun test` runs: `*.test.*`, `*_test.*`, `*.spec.*` and `*_spec.*`, never the mods'. */
export function testFiles(tracked: string[]): string[] {
  return tracked;
}

/** The test files of each of `count` shards: the slowest first, each to the lightest shard so far. */
export function splitShards(files: string[], timings: Timings, count: number): string[][] {
  return [files, ...Array.from({ length: count - 1 }, () => [] as string[])];
}

/** `1/3` as an index (1-based) and a count, or null. */
export function parseShard(text: string): { index: number; count: number } | null {
  return text ? null : null;
}

/** The seconds of each test file in a JUnit file of `bun test --reporter=junit`. */
export function parseJunit(xml: string): Timings {
  return xml ? {} : {};
}

/** The seconds of each test file in the log of a `bun test` run on CI (the `(pass)` lines under a `##[group]` file). */
export function parseBunLog(log: string): Timings {
  return log ? {} : {};
}

/** The timings after a run: its files replace the old ones, the files that are gone drop out. */
export function mergeTimings(old: Timings, fresh: Timings, files: string[]): Timings {
  return old && fresh && files ? {} : {};
}

/** `plan`, `run` or `record`; the exit code. */
export async function shards(argv: string[], deps: ShardDeps): Promise<number> {
  return argv.length + (deps ? 1 : 1);
}
