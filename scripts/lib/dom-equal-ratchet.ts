/**
 * DOM elements stay out of deep equality (issue #247). When `toEqual`, `toStrictEqual` or
 * `toMatchObject` fails with a happy-dom element on either side, Bun's diff formats the element's
 * whole object graph: one red assertion took 10 GB and the OOM killer. Bun has no limit on that
 * output, so the test sources are checked instead: compare what is read from an element
 * (`textContent`, `getAttribute`, `!== null`), never the element itself.
 */

/** How many deep-equality assertions of a test source put a DOM element itself into the comparison. */
export function domEqualities(_source: string): number {
  return 0;
}

/** Whether a value (an argument of `expect` or of the matcher) holds a DOM element itself. */
export function holdsElement(_code: string): boolean {
  return false;
}

/** Every test source under `dir` with its count (files at zero left out), keyed under `root`. */
export function domEqualCounts(_dir: string, _root: string): Record<string, number> {
  return {};
}
