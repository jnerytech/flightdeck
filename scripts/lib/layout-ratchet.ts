/** How many raw layout utilities each screen may still hold: the count per file, only ever down. */
export type LayoutBaseline = Record<string, number>;

/** The files over their baseline (a file missing from it may hold none), as `file: n > max`. */
export function overBaseline(_counts: LayoutBaseline, _baseline: LayoutBaseline): string[] {
  return ["stub"];
}

/** The baseline lowered to the current counts: never raised, and a file at zero leaves it. */
export function tightened(_counts: LayoutBaseline, baseline: LayoutBaseline): LayoutBaseline {
  return { ...baseline };
}
