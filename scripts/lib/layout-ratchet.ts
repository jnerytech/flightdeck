import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { layoutViolations } from "./style-lint.ts";

/** How many raw layout utilities each screen may still hold: the count per file, only ever down. */
export type LayoutBaseline = Record<string, number>;

/** Every `.tsx` under `dir` with its count of raw layout utilities (files with none left out), keyed relative to `root`. */
export function screenCounts(dir: string, root: string): LayoutBaseline {
  const counts: LayoutBaseline = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) {
        const n = layoutViolations(readFileSync(path, "utf8")).length;
        if (n > 0) counts[relative(root, path).replaceAll("\\", "/")] = n;
      }
    }
  };
  walk(dir);
  return counts;
}

/** The files over their baseline (a file missing from it may hold none), as `file: n > max`. */
export function overBaseline(counts: LayoutBaseline, baseline: LayoutBaseline): string[] {
  return Object.entries(counts)
    .filter(([file, n]) => n > (baseline[file] ?? 0))
    .map(([file, n]) => `${file}: ${n} > ${baseline[file] ?? 0}`);
}

/** The baseline lowered to the current counts: never raised, and a file at zero leaves it. */
export function tightened(counts: LayoutBaseline, baseline: LayoutBaseline): LayoutBaseline {
  const next: LayoutBaseline = {};
  for (const [file, max] of Object.entries(baseline)) {
    const n = counts[file] ?? 0;
    if (n > 0) next[file] = Math.min(n, max);
  }
  return next;
}
