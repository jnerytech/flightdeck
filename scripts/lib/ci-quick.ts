/**
 * The tests the CI's quick job runs (#272): every ratchet (a test that compares the repository with
 * a committed count, named `*-ratchet.test.ts`) and the protocol surface. They take seconds, so a
 * count that went up fails the run in minutes, before the heavy jobs start.
 */
const QUICK_TEST = /(?:-ratchet|(?:^|\/)protocol-surface)\.test\.tsx?$/;

export function quickTests(tracked: readonly string[]): string[] {
  return tracked.filter((path) => QUICK_TEST.test(path)).sort();
}
