/**
 * Repo-wide tests (#1108): a test that scans the real repository with `git ls-files` checks files
 * it neither imports nor names, so a PR's run (`test:related --pr`) picks it only by chance, and a
 * PR could merge green and turn main red (#1062 on md-links, #1083 on sort-compare). Such a test
 * carries a `// repo-wide` comment line, and CI's quick job runs every marked test on every PR.
 */

/** Whether a test's source carries the `// repo-wide` marker on a line of its own. */
export function isRepoWide(_source: string): boolean {
  return false;
}

/**
 * Whether a test's source runs `git ls-files` on the real repository: a real spawn of git (not a
 * faked `args[0] === "ls-files"`) with `cwd: ROOT` or no cwd. A temp repo or a fixture runs it
 * with another cwd, and does not count.
 */
export function scansRealRepo(_source: string): boolean {
  return false;
}

/** The test files that scan the real repository without the marker, one line each. */
export function unmarkedRepoScans(_files: { path: string; content: string }[]): string[] {
  return [];
}
