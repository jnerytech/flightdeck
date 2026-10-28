export interface Commit {
  hash: string;
  subject: string;
  type: string | null;
  scope: string | null;
}

export interface Violation {
  /** Commit hash, or `file:line` for forbidden markers. */
  commit: string;
  scope: string;
  reason: string;
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?!?: /;
const NEEDS_TEST = new Set(["feat", "fix"]);
const MARKERS = [/\.only\(/, /\.skip\(/, /\btest\.todo\(/];
const MARKER_TEXT = [".only(", ".skip(", "test.todo("];

/** Parses `git log --format=%H%x1f%s` output into conventional-commit parts. */
export function parseCommits(log: string): Commit[] {
  return log
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [hash = "", subject = ""] = line.split("\x1f");
      const match = CONVENTIONAL.exec(subject);
      return { hash, subject, type: match?.[1] ?? null, scope: match?.[2] ?? null };
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
      MARKERS.forEach((marker, m) => {
        if (marker.test(line)) {
          violations.push({
            commit: `${file.path}:${i + 1}`,
            scope: "-",
            reason: `uso proibido de ${MARKER_TEXT[m]}`,
          });
        }
      });
    });
  }
  return violations;
}

export interface AuditDeps {
  since: string;
  /** Runs git with the given arguments; `null` when git fails. */
  git: (args: string[]) => string | null;
  readFile: (path: string) => string;
}

export function runAudit({ since, git, readFile }: AuditDeps): { code: number; output: string } {
  if (git(["rev-parse", "--verify", `${since}^{commit}`]) === null) {
    return { code: 2, output: `tag ou commit desconhecido: ${since}` };
  }
  const commits = parseCommits(
    git(["log", "--reverse", "--format=%H%x1f%s", `${since}..HEAD`]) ?? "",
  );
  const files = (git(["ls-files", "*.test.ts", "*.test.tsx"]) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((path) => ({ path, content: readFile(path) }));
  const violations = [...auditCommits(commits), ...findForbiddenMarkers(files)];
  if (violations.length === 0) return { code: 0, output: "TDD AUDIT OK" };
  return {
    code: 1,
    output: [
      `TDD AUDIT FAIL: ${violations.length} violação(ões)`,
      ...violations.map((v) => `  ${v.commit}  ${v.scope}  ${v.reason}`),
    ].join("\n"),
  };
}
