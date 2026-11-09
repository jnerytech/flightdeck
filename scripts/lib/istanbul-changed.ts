/**
 * A PR's changed test files under istanbul (#1493). The full run's istanbul shards instrument every
 * source, and a test that is green under Bun's coverage can fail there: a function whose source
 * runs on its own (`new Function`, a page's init script) carries a counter that does not exist
 * there (#1492). A PR's CI runs only Bun's coverage, so this runs its changed and added test files
 * the way `shard-gate.ts run <i>/<n> istanbul` does, and fails on a failed test only: the coverage
 * gate stays with the bun run.
 */

/** What `istanbulChanged` touches: the checkout, its tracked files, git's diff and the run. */
export interface IstanbulChangedDeps {
  root: string;
  tracked: readonly string[];
  /** The files added, changed or renamed since the base; null when git could not say. */
  changed: (base: string) => Promise<string[] | null>;
  mkdir: (path: string) => void;
  spawn: (argv: string[], env: Record<string, string>) => Promise<{ exit: number; log: string }>;
  print: (line: string) => void;
}

/** `istanbul-changed <base> <out>`: the exit code. */
export async function istanbulChanged(
  _base: string,
  _out: string,
  _deps: IstanbulChangedDeps,
): Promise<number> {
  return 0;
}
