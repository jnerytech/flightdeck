/**
 * The security gate of `bun run handoff:check` (#273): the changed source files whose added lines
 * spawn or kill a process, delete files, handle a secret or a permission, or live in the vault or
 * the pairing code, and whether the security-reviewer's verdict was committed after the last of
 * them, as a `Security-Reviewed: <summary>` trailer.
 */
import { auditBase } from "./tdd-audit.ts";

export interface RiskyFile {
  path: string;
  /** The risk areas its added lines touch, e.g. "spawn", "delete". */
  why: string[];
}

export interface BranchCommit {
  sha: string;
  files: string[];
  /** The `Security-Reviewed:` trailer's text, or null. */
  reviewed: string | null;
}

/**
 * Reads one file header line: a "+++" line starts the file's list of added lines (none for a
 * deleted file), and a "rename to" line (a pure rename has no hunk) registers the new path.
 */
function readHeader(
  line: string,
  added: Map<string, string[]>,
  current: string[] | null,
): string[] | null {
  if (line.startsWith("rename to ")) {
    const path = line.slice("rename to ".length);
    if (!added.has(path)) added.set(path, []);
    return current;
  }
  if (!line.startsWith("+++ ")) return current;
  // git ends a name with a space with a tab; "/dev/null" (a deleted file) adds nothing.
  const path = line.slice(4).replace(/\t$/, "");
  if (!path.startsWith("b/")) return null;
  const lines: string[] = [];
  added.set(path.slice(2), lines);
  return lines;
}

/** The added lines of each file in a `git diff -U0` output. */
export function addedLines(diff: string): Map<string, string[]> {
  const added = new Map<string, string[]>();
  let current: string[] | null = null;
  // A header line comes only between `diff --git` and the first hunk: inside a hunk, an added
  // line that reads "++ b/x" shows as "+++ b/x" and stays an added line.
  let inHeader = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      inHeader = true;
    } else if (line.startsWith("@@")) inHeader = false;
    else if (inHeader) current = readHeader(line, added, current);
    else if (current && line.startsWith("+")) current.push(line.slice(1));
  }
  return added;
}

/** A file whose added lines the gate reads: code, never a test, a fixture or a document. */
const SOURCE = /\.(?:[cm]?[jt]sx?|rs|sh|ps1|py)$/;
const NOT_SOURCE =
  /^(?:(?:apps|packages)\/[^/]+\/test|scripts\/(?:test|e2e))\/|\.(?:test|e2e)\.[cm]?[jt]sx?$/;
/** A line that is only a comment says nothing the code does. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*|#(?!!))/;

/** The risk areas, in the order they are named, each by what an added line says. */
const AREAS: [string, RegExp][] = [
  [
    "spawn",
    /\bspawn\w*\s*\(|\b(?:execFileSync|execFile|execSync)\s*\(|(?<![.\w])exec\s*\(|\b(?:cp|childProcess|child_process)\.exec\w*\s*\(|\bchild_process\b|\bBun\.\$|\bfork\s*\(|\bnew Worker\b|\bexeca\w*\s*\(|\.kill\s*\(|\bprocess\.kill\b|\btaskkill\b|\bpkill\b/,
  ],
  [
    "delete",
    /\b(?:rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink)\s*\(|\bRemove-Item\b|\brm\s+-[a-z]*[rf]/,
  ],
  ["secret", /\b(?:token|secret|password|credential|api[_-]?key)s?\b/i],
  ["permission", /\bchmod(?:Sync)?\b|\bchown|\bpermission|\ballowedNetworks\b/i],
  ["network", /\bBun\.(?:serve|listen|connect)\b|\bfetch\s*\(|\bnew WebSocket\b|\.listen\s*\(/],
];
/** Paths that are risky whatever they add: the vault and pairing code, the Tauri shell's
 * capabilities and config (CSP, scopes), and the CI workflows. */
const SENSITIVE_PATHS: [string, RegExp][] = [
  ["vault or pairing", /(?:^|\/)[^/]*(?:vault|pairing)[^/]*(?:\/|$)/i],
  ["tauri config", /\/src-tauri\/capabilities\/|(?:^|\/)tauri(?:\.[\w-]+)?\.conf\.json$/],
  ["workflow", /^\.github\/workflows\//],
];

/** The changed source files (never a test) in a risk area, sorted by path. */
export function riskyFiles(added: Map<string, string[]>): RiskyFile[] {
  const risky: RiskyFile[] = [];
  for (const [path, lines] of added) {
    if (NOT_SOURCE.test(path)) continue;
    const code = SOURCE.test(path) ? lines.filter((line) => !COMMENT.test(line)) : [];
    const why = AREAS.filter(([, pattern]) => code.some((line) => pattern.test(line))).map(
      ([name]) => name,
    );
    for (const [name, pattern] of SENSITIVE_PATHS) if (pattern.test(path)) why.push(name);
    if (why.length > 0) risky.push({ path, why });
  }
  return risky.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The commits of `git log --format=%x1e%H%x1f%(trailers:key=Security-Reviewed,valueonly) --name-only`, newest first. */
export function parseBranchLog(log: string): BranchCommit[] {
  return log
    .split("\x1e")
    .filter((record) => record.includes("\x1f"))
    .map((record) => {
      const [sha = "", rest = ""] = record.split("\x1f");
      const [trailer = "", ...files] = rest.split("\n");
      return {
        sha: sha.trim(),
        files: files.map((f) => f.trim()).filter(Boolean),
        reviewed: trailer.trim() || null,
      };
    });
}

/** Why the hand-off needs a security review, or null when none is needed or one came after the last risky commit. */
export function securityProblem(risky: RiskyFile[], commits: BranchCommit[]): string | null {
  if (risky.length === 0) return null;
  const paths = new Set(risky.map((r) => r.path));
  const last = commits.findIndex((c) => c.files.some((f) => paths.has(f)));
  // No commit of the log touches them (a merge that resolved them by itself, a base that differs):
  // no review can be placed after them, so none vouches.
  const since = last < 0 ? [] : commits.slice(0, last + 1);
  if (since.some((c) => c.reviewed)) return null;
  return [
    `security: ${risky.length} risky file(s) changed with no review after their last commit:`,
    ...risky.map((r) => `  ${r.path} (${r.why.join(", ")})`),
    "Run the security-reviewer agent on this branch, fix what it finds, then commit its verdict:",
    '  git commit --allow-empty -m "chore(security): security-reviewer verdict (#N)" -m "Security-Reviewed: <its one-line summary>"',
  ].join("\n");
}

/** Runs git with these arguments: its stdout, or null when it failed. */
export type GitRun = (args: string[]) => string | null;

export interface SecurityVerdict {
  /** "0" when nothing needs a review or one came after; "unreviewed"; "unknown" when git failed. */
  verdict: "0" | "unreviewed" | "unknown";
  /** What to print: the risky files and what to do, or why the gate could not run. */
  message: string | null;
}

/** The gate end to end (#273): the base, the diff and the log from git, then the verdict. */
export function securityVerdict(git: GitRun, base?: string): SecurityVerdict {
  const unknown = (why: string): SecurityVerdict => ({
    verdict: "unknown",
    message: `security: ${why}, so the gate cannot vouch`,
  });
  // --base is resolved to a commit first: a value that starts with "-" never reaches git as an option.
  const ref = (
    base ? git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]) : auditBase(git)
  )?.trim();
  if (!ref) return unknown(base ? `${base} is not a commit` : "no base to compare with");
  // The prefixes are forced (a user's diff.noprefix or mnemonicPrefix would change the headers),
  // and no external diff or text conversion runs. Names come unquoted.
  const quiet = ["-c", "core.quotepath=off"];
  const diff = git([
    ...quiet,
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "-M",
    `${ref}...HEAD`,
  ]);
  if (diff === null) return unknown("git diff failed");
  // Topological order, so "after" follows the history, not the dates; a merge lists the files it
  // edited itself (combined); a folded trailer is one line.
  const log = git([
    ...quiet,
    "log",
    "--topo-order",
    "--diff-merges=combined",
    "--format=%x1e%H%x1f%(trailers:key=Security-Reviewed,valueonly,unfold,separator=%x20)",
    "--name-only",
    `${ref}..HEAD`,
  ]);
  if (log === null) return unknown("git log failed");
  const problem = securityProblem(riskyFiles(addedLines(diff)), parseBranchLog(log));
  return problem ? { verdict: "unreviewed", message: problem } : { verdict: "0", message: null };
}
