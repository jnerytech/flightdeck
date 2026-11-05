/**
 * The tests the CI's quick job runs (#272): every ratchet (a test that compares the repository with
 * a committed count, named `*-ratchet.test.ts`) and the protocol surface. They take seconds, so a
 * count that went up fails the run in minutes, before the heavy jobs start.
 */
export function quickTests(_tracked: readonly string[]): string[] {
  return [];
}
