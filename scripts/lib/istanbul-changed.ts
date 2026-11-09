/**
 * A PR's changed test files under istanbul (#1493). The full run's istanbul shards instrument every
 * source, and a test that is green under Bun's coverage can fail there: a function whose source
 * runs on its own (`new Function`, a page's init script) carries a counter that does not exist
 * there (#1492). A PR's CI runs only Bun's coverage, so this runs its changed and added test files
 * the way `shard-gate.ts run <i>/<n> istanbul` does, and fails on a failed test only: the coverage
 * gate stays with the bun run.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { failedCount, istanbulTargets, shardRun } from "./shard-gate.ts";
import { testFiles } from "./test-shards.ts";

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
  base: string,
  out: string,
  deps: IstanbulChangedDeps,
): Promise<number> {
  if (!base || !out) {
    deps.print("usage: bun run scripts/istanbul-changed.ts <base> <out>");
    return 2;
  }
  // The istanbul preload writes its counters there, and the repo guard fails a run that leaves a
  // file in the checkout.
  const inside = relative(deps.root, resolve(out));
  if (!inside.startsWith("..") && !isAbsolute(inside)) {
    deps.print(`istanbul-changed: write the output outside the checkout, not in ${out}`);
    return 2;
  }
  const changed = await deps.changed(base);
  if (changed === null) {
    deps.print(`istanbul-changed: git could not list the files changed since ${base}`);
    return 1;
  }
  // Only tracked test files: a deleted one is gone, and a bun test with no file runs the whole suite.
  const wanted = new Set(changed);
  const files = testFiles([...deps.tracked]).filter((path) => wanted.has(path));
  if (files.length === 0) {
    deps.print(`istanbul-changed: no changed test files since ${base}`);
    return 0;
  }
  deps.mkdir(out);
  const plan = shardRun("istanbul", files, out, istanbulTargets(deps.tracked));
  const { exit, log } = await deps.spawn(plan.argv, plan.env);
  for (const line of log.split("\n")) deps.print(line);
  return exit !== 0 || failedCount(log) > 0 ? 1 : 0;
}
