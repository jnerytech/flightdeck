import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

/** Files that hold the shared waits themselves. */
const SHARED = new Set(["wait.ts", "helpers.ts", "fixtures.ts"]);

/** A definition at the start of a line: `function settle…`, or `const waitFor = (async) (…) =>`. */
const OWN_WAIT =
  /^[ \t]*(?:(?:export )?(?:async )?function (?:settle|waitFor|until)\w*\(|const (?:settle|waitFor|until)\w* = (?:async )?\()/gm;

/** How many waits of its own a test source defines (`function settle`, `const waitFor = …`). */
export function localWaits(source: string): number {
  return [...source.matchAll(OWN_WAIT)].length;
}

/** Every test source under `dir` with its count of local waits (none left out), keyed under `root`. */
export function waitCounts(dir: string, root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !SHARED.has(entry.name)) {
        const n = localWaits(readFileSync(path, "utf8"));
        if (n > 0) counts[relative(root, path).replaceAll("\\", "/")] = n;
      }
    }
  };
  walk(dir);
  return counts;
}
