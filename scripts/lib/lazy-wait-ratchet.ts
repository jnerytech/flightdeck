/** Lines after a fixed wait that still count as "right after it". */
export const WINDOW = 0;

/** How many fixed waits in a test source are followed, within `WINDOW` lines, by a one-shot query. */
export function fixedWaitSites(_source: string): number {
  return -1;
}

/** Every test source under `dir` with its count of such sites (none left out), keyed under `root`. */
export function fixedWaitCounts(_dir: string, _root: string): Record<string, number> {
  return { stub: -1 };
}
