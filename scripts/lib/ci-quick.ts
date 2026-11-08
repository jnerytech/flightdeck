/**
 * The tests the CI's quick job runs (#272): every ratchet (a test that compares the repository with
 * a committed count, named `*-ratchet.test.ts`), the protocol surface, and every test marked
 * `// repo-wide` (#1108): a scan of the whole repository, such as md-links (#1068) or sort-compare,
 * that a PR's run picks only when the PR touches what it imports, so a PR could merge green and turn
 * main red. They take seconds, so a count that went up fails the run in minutes, before the heavy
 * jobs start.
 */
import { byCodeUnit } from "@flightdeck/protocol";
import { isRepoWide } from "./repo-wide.ts";

const QUICK_TEST = /(?:-ratchet|(?:^|\/)protocol-surface)\.test\.tsx?$/;
const TEST_FILE = /\.test\.tsx?$/;

/** The quick tests among the tracked files; `read` gives a file's source, to find the marker. */
export function quickTests(tracked: readonly string[], read: (path: string) => string): string[] {
  const marked = (path: string) => {
    try {
      return isRepoWide(read(path));
    } catch {
      // A tracked file missing from the working tree is not marked; the run goes on (#1114 review).
      return false;
    }
  };
  return tracked
    .filter((path) => QUICK_TEST.test(path) || (TEST_FILE.test(path) && marked(path)))
    .sort(byCodeUnit);
}
