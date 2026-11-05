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

/** Marks a mode change among a file's added lines: no added line of a diff can start with NUL. */
const MODE_CHANGE = "\u0000mode ";

/**
 * Reads one file header line: a "+++" line starts the file's list of added lines (none for a
 * deleted file), and a "rename to" line (a pure rename has no hunk) registers the new path.
 */
function readHeader(
  line: string,
  added: Map<string, string[]>,
  current: string[] | null,
  file: string,
): string[] | null {
  // A mode change (chmod) has no hunk: it counts as a permission change of the file, whatever it is.
  if (line.startsWith("new mode ")) {
    added.set(file, [
      ...(added.get(file) ?? []),
      `${MODE_CHANGE}${line.slice("new mode ".length)}`,
    ]);
    return current;
  }
  // A deleted file keeps its path, so the path rules (a guard, the vault) still see it.
  if (line.startsWith("deleted file mode ")) {
    if (!added.has(file)) added.set(file, []);
    return current;
  }
  if (line.startsWith("rename to ")) {
    const path = line.slice("rename to ".length);
    if (!added.has(path)) added.set(path, []);
    return current;
  }
  if (!line.startsWith("+++ ")) return current;
  // git ends a name with a space with a tab; "/dev/null" (a deleted file) adds nothing.
  const path = line.slice(4).replace(/\t$/, "");
  if (!path.startsWith("b/")) return null;
  const lines = added.get(path.slice(2)) ?? [];
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
  // The file of the current header, from "diff --git a/<old> b/<new>" (the prefixes are forced).
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      inHeader = true;
      file = line.slice(line.lastIndexOf(" b/") + 3);
    } else if (line.startsWith("@@")) inHeader = false;
    else if (inHeader) current = readHeader(line, added, current, file);
    else if (current && line.startsWith("+")) current.push(line.slice(1));
  }
  return added;
}

/** A file whose added lines the gate reads: code, never a test, a fixture or a document. */
const SOURCE = /\.(?:[cm]?[jt]sx?|rs|sh|ps1|py)$/;
/** Tests, fixtures and journeys: their folders, and test files anywhere. */
const NOT_SOURCE = [
  /^(?:apps|packages)\/[^/]+\/test\//,
  /^scripts\/(?:test|e2e)\//,
  /\.(?:test|e2e)\.[cm]?[jt]sx?$/,
];
/** Files where `#` starts a comment (in TypeScript it is a private field). */
const HASH_COMMENTS = /\.(?:sh|py|ps1)$/;

/**
 * Whether an added line is a comment and nothing else. A line is never cut: one that holds any
 * code is read whole, so a "*\/" in a glob or comment marks in a string cannot hide what it does.
 */
function commentOnly(line: string, path: string): boolean {
  return (
    /^\s*\/\//.test(line) ||
    // One block comment and nothing after it, or a block that stays open.
    /^\s*\/\*(?:(?!\*\/).)*(?:\*\/\s*)?$/.test(line) ||
    // A doc line inside a block, with no close on it.
    /^\s*\*(?!\/)(?:(?!\*\/).)*$/.test(line) ||
    (HASH_COMMENTS.test(path) && /^\s*#(?!!)/.test(line))
  );
}

/** The risk areas, in the order they are named, each by what an added line says (any pattern). */
const AREAS: [string, RegExp[]][] = [
  [
    "spawn",
    [
      /\bspawn\w*\s*\(/,
      /\b(?:execFileSync|execFile|execSync)\s*\(/,
      /(?<![.\w])exec\s*\(/,
      /\b(?:cp|childProcess|child_process)\.exec\w*\s*\(/,
      /\bchild_process\b/,
      /\bBun\.\$/,
      /\bfork\s*\(/,
      /\bnew Worker\b/,
      /\bexeca\w*\s*\(/,
      /\.kill\s*\(|\bprocess\.kill\b/,
      /\b(?:taskkill|pkill)\b/,
      /Command::new\s*\(|\bstd::process\b/,
      /\bsubprocess\./,
      /\bos\.(?:system|popen|exec\w*|spawn\w*)\s*\(/,
    ],
  ],
  [
    "delete",
    [
      /\b(?:rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink)\s*\(/,
      /\bRemove-Item\b/,
      /\brm\s+-[a-z]*[rf]/,
      /\bremove_(?:file|dir|dir_all)\s*\(/,
      /\bshutil\.rmtree\b/,
      /\bos\.(?:remove|unlink|rmdir)\s*\(/,
    ],
  ],
  ["secret", [/\b(?:token|secret|password|credential|api[_-]?key)s?\b/i]],
  ["permission", [/\bchmod(?:Sync)?\b|\bchown/i, /\bpermission/i, /\ballowedNetworks\b/i]],
  [
    "network",
    [
      /\bBun\.(?:serve|listen|connect)\b/,
      /\bfetch\s*\(/,
      /\bnew WebSocket\b/,
      /\.listen\s*\(/,
      /\bTcpListener::bind\b|\bTcpStream::connect\b/,
      /\bsocket\.(?:socket|create_connection)\b/,
      /\burllib\b|\brequests\.\w+\s*\(/,
    ],
  ],
];
/** Paths that are risky whatever they add (any pattern). */
const SENSITIVE_PATHS: [string, RegExp[]][] = [
  ["vault or pairing", [/(?:^|\/)[^/]*(?:vault|pairing)[^/]*(?:\/|$)/i]],
  // The Tauri shell's capabilities and config (CSP, scopes).
  ["tauri config", [/\/src-tauri\/capabilities\//, /(?:^|\/)tauri(?:\.[\w-]+)?\.conf\.json$/]],
  ["workflow", [/^\.github\/workflows\//]],
  // The gate and the checks it stands with: a change that weakens one needs a review too.
  [
    "guard",
    [
      /^scripts\/lib\/(?:security-gate|claude-hooks|tdd-audit|handoff|bounded-run)\.ts$/,
      /^scripts\/(?:handoff-check|pr-flow)\.ts$/,
      /^\.github\/actions\//,
      /^\.claude\/agents\/security-reviewer\.md$/,
    ],
  ],
  // Files whose contents run as code: package scripts, the Rust build, bun's config, Claude's
  // settings and hooks.
  [
    "runs code",
    [
      /(?:^|\/)(?:package\.json|Cargo\.toml|build\.rs)$/,
      /^bunfig[\w.]*\.toml$/,
      /^\.claude\/settings[\w.-]*\.json$/,
      /^\.claude\/hooks\//,
    ],
  ],
];

/** Whether any of these patterns matches. */
const any = (patterns: RegExp[], text: string) => patterns.some((pattern) => pattern.test(text));

/** The removed lines of each file in a `git diff -U0` output (#284). */
export function removedLines(diff: string): Map<string, string[]> {
  const removed = new Map<string, string[]>();
  let file = "";
  let inHeader = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = line.slice(line.lastIndexOf(" b/") + 3);
      inHeader = true;
    } else if (line.startsWith("@@")) inHeader = false;
    else if (!inHeader && line.startsWith("-")) {
      removed.set(file, [...(removed.get(file) ?? []), line.slice(1)]);
    }
  }
  return removed;
}

/**
 * The files the added lines did not make risky whose removed lines are risky, or whose code that
 * stays (read from HEAD) is: removing a check in front of a spawn needs a review too (#284).
 */
export function riskyEdits(
  risky: RiskyFile[],
  removed: Map<string, string[]>,
  read: (path: string) => string | null,
): RiskyFile[] {
  const known = new Set(risky.map((r) => r.path));
  const edits: RiskyFile[] = [];
  for (const [path, lines] of removed) {
    if (known.has(path) || any(NOT_SOURCE, path) || !SOURCE.test(path)) continue;
    const gone = areasOf(lines, path);
    const why =
      gone.length > 0
        ? gone.map((area) => `removes ${area}`)
        : areasOf((read(path) ?? "").split("\n"), path).map((area) => `edits ${area} code`);
    if (why.length > 0) edits.push({ path, why });
  }
  return edits.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The risk areas these lines of code touch, comments left out. */
function areasOf(lines: string[], path: string): string[] {
  const code = lines.filter((line) => !commentOnly(line, path));
  return AREAS.filter(([, patterns]) => code.some((line) => any(patterns, line))).map(
    ([name]) => name,
  );
}

/** The changed source files (never a test) in a risk area, sorted by path. */
export function riskyFiles(added: Map<string, string[]>): RiskyFile[] {
  const risky: RiskyFile[] = [];
  for (const [path, lines] of added) {
    if (any(NOT_SOURCE, path)) continue;
    const modeChanged = lines.some((line) => line.startsWith(MODE_CHANGE));
    const added = lines.filter((line) => !line.startsWith(MODE_CHANGE));
    const why = SOURCE.test(path) ? areasOf(added, path) : [];
    if (modeChanged && !why.includes("permission")) why.push("permission");
    for (const [name, patterns] of SENSITIVE_PATHS) if (any(patterns, path)) why.push(name);
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
    "--no-show-signature",
    "--topo-order",
    "--diff-merges=combined",
    "--format=%x1e%H%x1f%(trailers:key=Security-Reviewed,valueonly,unfold,separator=%x20)",
    "--name-only",
    `${ref}..HEAD`,
  ]);
  if (log === null) return unknown("git log failed");
  // Removed lines count too: taking a check out in front of a spawn needs a review (#284).
  const added = riskyFiles(addedLines(diff));
  const edits = riskyEdits(added, removedLines(diff), (path) => git(["show", `HEAD:${path}`]));
  const risky = [...added, ...edits].sort((a, b) => (a.path < b.path ? -1 : 1));
  const problem = securityProblem(risky, parseBranchLog(log));
  return problem ? { verdict: "unreviewed", message: problem } : { verdict: "0", message: null };
}
