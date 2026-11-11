/**
 * Issue #1606: the dead code knip finds, counted by kind. knip-baseline.json holds the count of each
 * kind (unused files, exports, types, dependencies) and only goes down; like the dependency-cruiser
 * baseline (#1591) it counts, so a move that renames the files a finding sits in does not break it.
 */

/** How many findings of each kind a knip JSON report holds (kinds with none left out). */
export function knipCounts(_report: string): Record<string, number> {
  return { stub: -1 };
}
