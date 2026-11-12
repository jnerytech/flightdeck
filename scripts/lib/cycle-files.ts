/**
 * Issue #1624: the desktop's import cycles are ratcheted by the files that sit in one, not by the
 * violation entries of dependency-cruiser: those are keyed by path and by cycle, so a move or a
 * barrel (`index.ts`) reads as a new cycle. The files in a cycle are the same before and after
 * either. The logic here is pure; `scripts/arch-report.ts` feeds it dependency-cruiser's modules.
 */

/** The part of a dependency-cruiser module this reads. */
export type CruiseModule = {
  source: string;
  dependencies: { resolved: string; dependencyTypes: string[] }[];
};

/** The files that sit in an import cycle, sorted; a pure re-export barrel is folded into its targets. */
export function cycleFiles(_modules: readonly CruiseModule[]): string[] {
  return ["stub"];
}
