/**
 * The security gate of `bun run handoff:check` (#273): the changed source files whose added lines
 * spawn or kill a process, delete files, handle a secret or a permission, or live in the vault or
 * the pairing code, and whether the security-reviewer's verdict was committed after the last of
 * them, as a `Security-Reviewed: <summary>` trailer.
 */

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
    else if (inHeader && line.startsWith("+++ ")) {
      // git ends a name with a space with a tab.
      const path = line.slice(4).replace(/\t$/, "");
      current = path.startsWith("b/") ? [] : null;
      if (current) added.set(path.slice(2), current);
    } else if (!inHeader && current && line.startsWith("+")) current.push(line.slice(1));
  }
  return added;
}

/** A file the gate reads: code, never a test, a fixture or a document. */
const SOURCE = /\.(?:ts|tsx|rs|sh|ps1)$/;
const NOT_SOURCE =
  /^(?:(?:apps|packages)\/[^/]+\/test|scripts\/(?:test|e2e))\/|\.(?:test|e2e)\.tsx?$/;

/** The risk areas, in the order they are named, each by what an added line says. */
const AREAS: [string, RegExp][] = [
  [
    "spawn",
    /\bspawn\w*\s*\(|\b(?:execFileSync|execFile|execSync)\s*\(|(?<![.\w])exec\s*\(|\.kill\s*\(|\bprocess\.kill\b|\btaskkill\b|\bpkill\b/,
  ],
  [
    "delete",
    /\b(?:rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink)\s*\(|\bRemove-Item\b|\brm\s+-[a-z]*[rf]/,
  ],
  ["secret", /\b(?:token|secret|password|credential|api[_-]?key)s?\b/i],
  ["permission", /\bchmod(?:Sync)?\b|\bchown|\bpermission|\ballowedNetworks\b/i],
  ["network", /\bBun\.(?:serve|listen|connect)\b|\bfetch\s*\(|\bnew WebSocket\b|\.listen\s*\(/],
];
/** A path in the vault or the pairing code is risky whatever it adds. */
const SENSITIVE_PATH = /(?:^|\/)[^/]*(?:vault|pairing)[^/]*(?:\/|$)/i;

/** The changed source files (never a test) in a risk area, sorted by path. */
export function riskyFiles(added: Map<string, string[]>): RiskyFile[] {
  const risky: RiskyFile[] = [];
  for (const [path, lines] of added) {
    if (!SOURCE.test(path) || NOT_SOURCE.test(path)) continue;
    const why = AREAS.filter(([, pattern]) => lines.some((line) => pattern.test(line))).map(
      ([name]) => name,
    );
    if (SENSITIVE_PATH.test(path)) why.push("vault or pairing");
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
  const since = last < 0 ? commits : commits.slice(0, last + 1);
  if (since.some((c) => c.reviewed)) return null;
  return [
    `security: ${risky.length} risky file(s) changed with no review after their last commit:`,
    ...risky.map((r) => `  ${r.path} (${r.why.join(", ")})`),
    "Run the security-reviewer agent on this branch, fix what it finds, then commit its verdict:",
    '  git commit --allow-empty -m "chore(security): security-reviewer verdict (#N)" -m "Security-Reviewed: <its one-line summary>"',
  ].join("\n");
}
