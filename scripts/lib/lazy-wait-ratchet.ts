import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

/** Files that hold the shared waits themselves. */
const SHARED = new Set(["wait.ts", "helpers.ts", "fixtures.ts"]);

/** Lines after a fixed wait, in its own block, that still count as "right after it". */
export const WINDOW = 5;

/** A wait of a fixed time: `Bun.sleep(…)`, `sleep(…)` or `setTimeout(…)`. */
const FIXED_WAIT = /\b(?:Bun\.sleep|sleep|setTimeout)\(/;

/** A one-shot query: it answers for this instant and never retries. */
const ONE_SHOT = /\b(?:get|query)(?:All)?By[A-Z]/;

/**
 * How many fixed waits in a test source are followed, within `WINDOW` lines, by a one-shot query.
 * A fixed time is a guess about the machine: on a loaded runner a lazy screen is not there yet and
 * the query finds nothing. `findBy*` or `waitFor` retry until the screen is there.
 */
export function fixedWaitSites(source: string): number {
  const lines = source.split("\n");
  const indent = (line: string) => line.length - line.trimStart().length;
  let sites = 0;
  lines.forEach((line, i) => {
    if (!FIXED_WAIT.test(line)) return;
    for (const below of lines.slice(i, i + 1 + WINDOW)) {
      // The block of the wait ends at the first line that steps out of it.
      if (below.trim() !== "" && indent(below) < indent(line)) return;
      if (ONE_SHOT.test(below)) {
        sites += 1;
        return;
      }
    }
  });
  return sites;
}

/** Every test source under `dir` with its count of such sites (none left out), keyed under `root`. */
export function fixedWaitCounts(dir: string, root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !SHARED.has(entry.name)) {
        const n = fixedWaitSites(readFileSync(path, "utf8"));
        if (n > 0) counts[relative(root, path).replaceAll("\\", "/")] = n;
      }
    }
  };
  walk(dir);
  return counts;
}
