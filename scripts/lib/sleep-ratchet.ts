import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Test folders whose files the sleep ratchet counts, relative to the repository root. */
export const SLEEP_ROOTS: readonly string[] = [
  "apps/daemon/test",
  "apps/desktop/test",
  "packages/protocol/test",
  "scripts/test",
];

/**
 * A wait of a guessed time, in each of its spellings: `Bun.sleep(…)`, `Bun.sleepSync(…)`, a promise
 * that resolves from a timer (the body may sit on the next line), and a call to a helper named
 * `sleep` or `delay` (its definition, `function sleep(`, is not a call).
 */
const FIXED_SLEEP = [
  /Bun\.sleep(?:Sync)?\(/g,
  /new Promise(?:<[^>]*>)?\(\s*\(?\s*\w+\s*\)?\s*=>\s*(?:\{\s*)?(?:globalThis\.|window\.)?setTimeout\(/g,
  /(?<![\w$.])(?<!function\s)(?:sleep|delay)\(/g,
];

/** The comment that says why the clock is the thing under test (a hold, a debounce). */
const TIMING_COMMENT = /^\s*\/\/ timing:/;

/** The source without its comments, with every line break kept so a match keeps its line. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * How many fixed sleeps a test source holds. A guessed time is a bet on the machine: on a loaded
 * runner it is too short, and everywhere else it is time wasted. Wait on the condition (`settle`,
 * `findBy*`, `stays`); a sleep stays only with a `// timing:` comment on the line above saying why
 * the clock itself is under test.
 */
export function fixedSleeps(source: string): number {
  const lines = source.split("\n");
  const code = withoutComments(source);
  let sites = 0;
  for (const pattern of FIXED_SLEEP) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split("\n").length - 1;
      let above = line - 1;
      while (above >= 0 && (lines[above] ?? "").trim() === "") above -= 1;
      if (above < 0 || !TIMING_COMMENT.test(lines[above] ?? "")) sites += 1;
    }
  }
  return sites;
}

/** Every test file under the roots with its count of fixed sleeps (none left out), keyed under `root`. */
export function sleepCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        const n = fixedSleeps(readFileSync(path, "utf8"));
        if (n > 0) counts[relative(root, path).replaceAll("\\", "/")] = n;
      }
    }
  };
  for (const dir of SLEEP_ROOTS) {
    if (existsSync(join(root, dir))) walk(join(root, dir));
  }
  return counts;
}
