/**
 * Repo-wide tests (#1108): a test that scans the real repository with `git ls-files` checks files
 * it neither imports nor names, so a PR's run (`test:related --pr`) picks it only by chance, and a
 * PR could merge green and turn main red (#1062 on md-links, #1083 on sort-compare). Such a test
 * carries a `// repo-wide` comment line, and CI's quick job runs every marked test on every PR.
 */

/** The marker: a comment line of its own that starts `// repo-wide`. */
const MARKER = /^[ \t]*\/\/ repo-wide\b(?!-)/m;

/** A real spawn of `git ls-files`: `spawnSync("git", ["ls-files"…` or `spawnSync(["git", "ls-files"…`. */
const LS_FILES = /spawnSync\(\s*(?:"git"\s*,\s*\[|\[\s*"git"\s*,)\s*"ls-files"/g;

/** The call's working folder, when it names one: `cwd: ROOT`, `cwd: repo`. */
const CWD = /\bcwd:\s*([\w.]+)/;

/** Whether a test's source carries the `// repo-wide` marker on a line of its own. */
export function isRepoWide(source: string): boolean {
  return MARKER.test(source);
}

/**
 * Whether a test's source runs `git ls-files` on the real repository: a real spawn of git (not a
 * faked `args[0] === "ls-files"`) with `cwd: ROOT` or no cwd. A temp repo or a fixture runs it
 * with another cwd, and does not count.
 */
export function scansRealRepo(source: string): boolean {
  for (const match of source.matchAll(LS_FILES)) {
    // The call's own text: up to the end of its statement.
    const end = source.indexOf(";", match.index);
    const call = source.slice(match.index, end === -1 ? source.length : end);
    const cwd = CWD.exec(call);
    if (!cwd || cwd[1] === "ROOT") return true;
  }
  return false;
}

/** The test files that scan the real repository without the marker, one line each. */
export function unmarkedRepoScans(files: { path: string; content: string }[]): string[] {
  return files
    .filter((file) => scansRealRepo(file.content) && !isRepoWide(file.content))
    .map(
      (file) =>
        `${file.path}: runs git ls-files on the repository root with no // repo-wide comment line, so CI's quick job would not run it on every PR (#1108)`,
    );
}
