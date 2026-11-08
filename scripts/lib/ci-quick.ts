/**
 * The tests the CI's quick job runs (#272): every ratchet (a test that compares the repository with
 * a committed count, named `*-ratchet.test.ts`), the protocol surface, and md-links (#1068), which
 * reads every doc and every doc path the code names: its tier (it runs git) kept it out of a PR's
 * run unless the PR touched what it reads, so a PR merged green and main went red. They take
 * seconds, so a count that went up fails the run in minutes, before the heavy jobs start.
 */
import { byCodeUnit } from "@flightdeck/protocol";

const QUICK_TEST = /(?:-ratchet|(?:^|\/)protocol-surface|^scripts\/test\/md-links)\.test\.tsx?$/;

export function quickTests(tracked: readonly string[]): string[] {
  return tracked.filter((path) => QUICK_TEST.test(path)).sort(byCodeUnit);
}
