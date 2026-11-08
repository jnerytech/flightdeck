/**
 * Repo-wide tests (#1108): a test that scans the real repository with `git ls-files` checks files
 * it neither imports nor names, so a PR's run (`test:related --pr`) picks it only by chance, and a
 * PR could merge green and turn main red (#1062 on md-links, #1083 on sort-compare). Such a test
 * carries a `// repo-wide` comment line, and CI's quick job runs every marked test on every PR.
 */

/** The marker: a comment line of its own that starts `// repo-wide`. */
const MARKER = /^[ \t]*\/\/ repo-wide\b(?!-)/m;

/** `git ls-files` as an argument (`"ls-files"`), or run as a shell line (`execSync("git ls-files …")`, `` $`git ls-files` ``). */
const LS_FILES = /"ls-files"|\bexec(?:Sync)?\(\s*["'`]git ls-files\b|\$`git ls-files\b/g;

/** A comment line: `// …` or a `*` line of a block comment. */
const COMMENT = /^\s*(?:\/\/|\*)/;

/** The text before it on its line, for a faked git: `args[0] === "ls-files"` or `case "ls-files":`. */
const FAKED = /(?:===?|\bcase)\s*$/;

/** A git wrapper whose first argument is the folder: `git(repo, "ls-files")`. */
const WRAPPER = /\b\w+\(\s*([A-Za-z_$][\w.$]*(?:\(\))?)\s*,\s*$/;

/** The call's working folder, when it names one: `cwd: ROOT`, `cwd: repo`. */
const CWD = /\bcwd:\s*([^,}\n]+)/;

/** A folder that is the repository root: `ROOT`, `REPO_ROOT`, `root`, `process.cwd()`, `resolve(import.meta.dir…)`. */
const ROOT_LIKE = /^(?:[A-Z_]*ROOT|root|repoRoot|process\.cwd\(\)|resolve\(import\.meta\.dir\b.*)$/;

/** Whether a test's source carries the `// repo-wide` marker on a line of its own. */
export function isRepoWide(source: string): boolean {
  return MARKER.test(source);
}

/**
 * Whether a test's source runs `git ls-files` on the real repository: any spawn, a shell string or
 * a git wrapper (not a faked `args[0] === "ls-files"`), with no cwd or a cwd that is the root under
 * any of its usual names. A temp repo or a fixture runs it in another folder, and does not count.
 */
export function scansRealRepo(source: string): boolean {
  for (const match of source.matchAll(LS_FILES)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const before = source.slice(lineStart, match.index);
    if (FAKED.test(before) || COMMENT.test(before)) continue;
    const wrapper = WRAPPER.exec(before);
    if (wrapper) {
      if (ROOT_LIKE.test(wrapper[1] ?? "")) return true;
      continue;
    }
    // The call's statement: from the end of the one before it to its own end.
    const start = source.lastIndexOf(";", match.index) + 1;
    const end = source.indexOf(";", match.index);
    const cwd = CWD.exec(source.slice(start, end === -1 ? source.length : end));
    if (!cwd || ROOT_LIKE.test((cwd[1] ?? "").trim())) return true;
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
