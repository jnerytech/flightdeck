/**
 * Issue #1606: the dead code knip finds, counted by kind. knip-baseline.json holds the count of each
 * kind (unused files, exports, types, dependencies) and only goes down; like the dependency-cruiser
 * baseline (#1591) it counts, so a move that renames the files a finding sits in does not break it.
 */

/** The finding kinds that are dead code; knip's duplicates and unresolved imports are other problems. */
const DEAD_CODE = [
  "files",
  "exports",
  "types",
  "dependencies",
  "devDependencies",
  "unlisted",
  "binaries",
];

/** How many findings of each kind a knip JSON report holds (kinds with none left out). */
export function knipCounts(report: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(report);
  } catch {
    throw new Error("knip printed no JSON report; run `bun x knip` to see why");
  }
  const issues = (parsed as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) throw new Error("the knip report has no `issues` list");
  const counts: Record<string, number> = {};
  for (const issue of issues as Record<string, unknown>[])
    for (const kind of DEAD_CODE) {
      const found = issue[kind];
      if (Array.isArray(found) && found.length > 0)
        counts[kind] = (counts[kind] ?? 0) + found.length;
    }
  return counts;
}
