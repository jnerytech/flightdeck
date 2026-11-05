export interface Commit {
  hash: string;
  subject: string;
  type: string | null;
  scope: string | null;
  /** The value of a `TDD-Waiver:` trailer: a feat/fix made without a test on purpose. */
  waiver?: string;
}

export interface Violation {
  /** Commit hash, or `file:line` for forbidden markers. */
  commit: string;
  scope: string;
  reason: string;
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?!?: /;
const NEEDS_TEST = new Set(["feat", "fix"]);
/** Focused, skipped and todo tests: never in committed test files (docs/TDD.md). */
export const FORBIDDEN_MARKERS = [
  { pattern: /\.only\(/g, text: ".only(" },
  { pattern: /\.skip\(/g, text: ".skip(" },
  { pattern: /\btest\.todo\(/g, text: "test.todo(" },
];

/** The log format `parseCommits` reads: hash, subject and the `TDD-Waiver` trailer's value. */
export const LOG_FORMAT =
  "--format=%H%x1f%s%x1f%(trailers:key=TDD-Waiver,valueonly,separator=%x20)";

/** Parses `git log` output in `LOG_FORMAT` (or just `%H%x1f%s`) into conventional-commit parts. */
export function parseCommits(log: string): Commit[] {
  return log
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [hash = "", subject = "", waiver = ""] = line.split("\x1f");
      const match = CONVENTIONAL.exec(subject);
      const commit: Commit = { hash, subject, type: match?.[1] ?? null, scope: match?.[2] ?? null };
      if (waiver.trim()) commit.waiver = waiver.trim();
      return commit;
    });
}

/** Every `feat`/`fix` needs an earlier `test` commit with exactly the same scope. */
export function auditCommits(commits: Commit[]): Violation[] {
  const tested = new Set<string>();
  const violations: Violation[] = [];
  for (const commit of commits) {
    if (commit.type === "test" && commit.scope) tested.add(commit.scope);
    if (!commit.type || !NEEDS_TEST.has(commit.type)) continue;
    if (!commit.scope) {
      violations.push({ commit: commit.hash, scope: "-", reason: `${commit.type} sem escopo` });
    } else if (!tested.has(commit.scope)) {
      violations.push({
        commit: commit.hash,
        scope: commit.scope,
        reason: `${commit.type} sem commit test(${commit.scope}) anterior`,
      });
    }
  }
  return violations;
}

/** Finds focused, skipped or todo tests left in test files. */
export function findForbiddenMarkers(files: { path: string; content: string }[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    file.content.split("\n").forEach((line, i) => {
      for (const { pattern, text } of FORBIDDEN_MARKERS) {
        if (line.match(pattern)) {
          violations.push({
            commit: `${file.path}:${i + 1}`,
            scope: "-",
            reason: `uso proibido de ${text}`,
          });
        }
      }
    });
  }
  return violations;
}

/** A fix/feat commit that was made without an earlier same-scope test commit, accepted on purpose. */
export interface Waiver {
  /** The full 40-character commit hash; an abbreviation never matches. */
  hash: string;
  scope: string;
  reason: string;
}

/** Parses the waiver file: a JSON array of `{ hash, scope, reason }`. Throws on a malformed entry. */
export function parseWaivers(text: string): Waiver[] {
  const list: unknown = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error("waivers must be a JSON array");
  return list.map((entry: Partial<Waiver>) => {
    const { hash, scope, reason } = entry;
    if (typeof hash !== "string" || !/^[0-9a-f]{40}$/.test(hash)) {
      throw new Error(`waiver hash must be the full 40 hex characters: ${String(hash)}`);
    }
    if (typeof scope !== "string" || scope.trim() === "")
      throw new Error(`waiver ${hash} has no scope`);
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(`waiver ${hash} has no reason`);
    }
    return { hash, scope, reason };
  });
}

/**
 * The commit `--since auto` audits from: the merge-base with `main` (`origin/main` first, then a
 * local `main`) on any other branch, or the last release tag (`v*`, never a `fase-N` tag) when
 * HEAD is on `main`, pushed or not. Null when neither can be found.
 */
export function auditBase(git: AuditDeps["git"]): string | null {
  const head = git(["rev-parse", "HEAD"])?.trim();
  if (!head) return null;
  const lastRelease = () =>
    git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD"])?.trim() || null;
  if (git(["symbolic-ref", "--short", "HEAD"])?.trim() === "main") return lastRelease();
  for (const main of ["origin/main", "main"]) {
    const base = git(["merge-base", "HEAD", main])?.trim();
    if (!base) continue;
    return base === head ? lastRelease() : base;
  }
  return null;
}

export interface AuditDeps {
  since: string;
  /** Accepted exceptions; every one must still match a violation in the audited range. */
  waivers?: Waiver[];
  /** Runs git with the given arguments; `null` when git fails. */
  git: (args: string[]) => string | null;
  readFile: (path: string) => string;
}

export function runAudit({ since: asked, git, readFile, waivers = [] }: AuditDeps): {
  code: number;
  output: string;
} {
  const since = asked === "auto" ? auditBase(git) : asked;
  if (since === null) {
    return { code: 2, output: "since auto: no merge-base with main and no tag to audit from" };
  }
  const autoLine = asked === "auto" ? [`  since ${since} (auto)`] : [];
  if (git(["rev-parse", "--verify", `${since}^{commit}`]) === null) {
    return { code: 2, output: `tag ou commit desconhecido: ${since}` };
  }
  const commits = parseCommits(git(["log", "--reverse", LOG_FORMAT, `${since}..HEAD`]) ?? "");
  const files = (git(["ls-files", "*.test.ts", "*.test.tsx"]) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((path) => ({ path, content: readFile(path) }));
  const found = auditCommits(commits);
  // A TDD-Waiver trailer waives its own commit; one on a commit that needs no waiver is ignored.
  const trailers: Waiver[] = commits.flatMap((c) =>
    c.waiver && c.scope ? [{ hash: c.hash, scope: c.scope, reason: `trailer: ${c.waiver}` }] : [],
  );
  const waived = [...waivers, ...trailers].filter((w) =>
    found.some((v) => v.commit === w.hash && v.scope === w.scope),
  );
  const inRange = new Set(commits.map((c) => c.hash));
  const stale: Violation[] = waivers
    .filter((w) => !waived.includes(w) && inRange.has(w.hash))
    .map((w) => ({
      commit: w.hash,
      scope: w.scope,
      reason: "stale waiver: the commit is in the audited range and is not a violation",
    }));
  const ignored = waivers
    .filter((w) => !inRange.has(w.hash))
    .map((w) => `  ignored  ${w.hash}  ${w.scope}  outside the audited range`);
  const open = found.filter((v) => !waived.some((w) => w.hash === v.commit && w.scope === v.scope));
  const violations = [...open, ...stale, ...findForbiddenMarkers(files)];
  const waivedLines = waived.map((w) => `  waived  ${w.hash}  ${w.scope}  ${w.reason}`);
  if (violations.length === 0) {
    const head = waived.length === 0 ? "TDD AUDIT OK" : `TDD AUDIT OK (${waived.length} waived)`;
    return { code: 0, output: [head, ...autoLine, ...waivedLines, ...ignored].join("\n") };
  }
  return {
    code: 1,
    output: [
      `TDD AUDIT FAIL: ${violations.length} violação(ões)`,
      ...autoLine,
      ...violations.map((v) => `  ${v.commit}  ${v.scope}  ${v.reason}`),
      ...(waived.length === 0 ? [] : [`${waived.length} waived:`, ...waivedLines]),
      ...ignored,
    ].join("\n"),
  };
}
