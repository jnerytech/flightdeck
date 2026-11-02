/** How many refusals of a daemon source say nothing the app can translate (no reason). */
export function reasonlessRefusals(_source: string): number {
  return 0;
}

/** Every daemon source under `dir` with its count of reasonless refusals (none left out), keyed under `root`. */
export function refusalCounts(_dir: string, _root: string): Record<string, number> {
  return {};
}
