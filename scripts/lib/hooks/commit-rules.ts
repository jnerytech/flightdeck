/**
 * The commit gate (docs/TDD.md): the subject is `type(scope): text`, a feat or fix names its issue
 * and has an earlier test commit of the same scope, and a `TDD-Waiver:` trailer lets an exception
 * through. It reads the command through shell-parse.
 */
import { auditBase, parseCommits } from "../guards/tdd-audit.ts";
import { gitCalls, HEREDOC, optionValue } from "./shell-parse.ts";

export interface CommitGateDeps {
  /** Runs git with these arguments in `cwd`; null when git fails. */
  git: (args: string[], cwd: string) => string | null;
  /** Whether `dir` is in this project's main checkout or one of its worktrees (default: yes). */
  inProject?: (dir: string) => boolean;
}

/**
 * Why the `git commit` in `command` is blocked: its subject is not `type(scope): text`, a
 * feat/fix has no scope, or a feat(x)/fix(x) has no earlier test(x) since the audit base
 * (docs/TDD.md). A `TDD-Waiver: <why>` trailer lets a deliberate exception through. `cwd` is where
 * the shell starts. Anything it cannot read (a message from an editor or a file, a quoted
 * directory, git failing) passes: the audit and CI still check it.
 */
export function commitViolation(command: string, cwd: string, deps: CommitGateDeps): string | null {
  const commit = findCommit(command, cwd);
  if (commit?.message == null) return null;
  if (commit.dir !== null && deps.inProject && !deps.inProject(commit.dir)) return null;
  const subject =
    commit.message
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "";
  if (/^(Merge |Revert |fixup! |squash! )/.test(subject)) return null;
  const match = SUBJECT.exec(subject);
  if (!match) {
    return `Commit subject "${subject}" is blocked: write type(scope): text, with type one of ${COMMIT_TYPES.join(", ")} (docs/TDD.md).`;
  }
  const [, type, scope] = match;
  if (type !== "feat" && type !== "fix") return null;
  if (!scope) {
    return `${type} needs a scope: ${type}(<area>): text, the same scope as its earlier test(<area>) commit (docs/TDD.md).`;
  }
  const lines = [commit.message, ...commit.trailers].join("\n");
  const text = subject.slice(match[0].length - 1);
  if (!ISSUE_IN_SUBJECT.test(text) && !ISSUE_LINE.test(lines)) {
    return `${type}(${scope}) needs an issue: end the subject with (#N), or add a line "Refs: #N" (or "Closes #N") to the message, so release:close can close it (docs/TDD.md).`;
  }
  if (commit.waived || commit.dir === null) return null;
  const dir = commit.dir;
  const git = (args: string[]) => deps.git(args, dir);
  const base = auditBase(git);
  if (base === null) return null;
  const log = git(["log", "--format=%H%x1f%s", `${base}..HEAD`]);
  if (log === null) return null;
  if (parseCommits(log).some((c) => c.type === "test" && c.scope === scope)) return null;
  return `${type}(${scope}) is blocked: no earlier test(${scope}) commit since ${base} (docs/TDD.md: commit the failing test first). For a deliberate exception, end the message with a trailer line "TDD-Waiver: <why>"; tdd:audit lists it.`;
}

/** Whether the command commits with a `TDD-Waiver:` trailer (the hook log counts these). */
export function commitWaived(command: string): boolean {
  return findCommit(command, "")?.waived ?? false;
}

const COMMIT_TYPES = [
  "test",
  "feat",
  "fix",
  "refactor",
  "chore",
  "docs",
  "perf",
  "build",
  "ci",
  "style",
  "revert",
];
const SUBJECT = new RegExp(String.raw`^(${COMMIT_TYPES.join("|")})(?:\(([^)]+)\))?!?: \S`);
const WAIVER = /^TDD-Waiver:[ \t]*\S/m;
/**
 * An issue in parentheses in the subject's text (after `type(scope): `): `(#12)`, `(#12, #13)`,
 * `(review of rc/0364, #237)`. One digit is enough for a presence test and keeps it linear.
 */
const ISSUE_IN_SUBJECT = /\([^()]*#\d[^()]*\)/;
/** A message line that names an issue: `Refs: #12`, `Closes #12`, `Fixes #12`, `Resolves #12`. */
const ISSUE_LINE = /^[ \t]*(?:refs|closes|fixes|resolves):?[ \t]+#\d+/im;

interface FoundCommit {
  /** Where it runs; null when a directory is quoted. */
  dir: string | null;
  /** The whole message, or null when the command gives none it can read. */
  message: string | null;
  /** The values of `--trailer`, which git appends to the message. */
  trailers: string[];
  waived: boolean;
}

/** The command's `git commit`: its directory and its message. */
function findCommit(command: string, cwd: string): FoundCommit | undefined {
  const call = gitCalls(command, cwd).find((c) => c.sub === "commit");
  if (!call) return undefined;
  const parts: string[] = [];
  const trailers: string[] = [];
  let waived = false;
  let fromStdin = false;
  call.args.forEach(({ word: w, at: pos }, j) => {
    const flag = /^(-m|--message|--trailer|-F|--file)(=)?/.exec(w);
    if (!flag) return;
    const valueAt = flag[2] ? pos + flag[0].length : call.args[j + 1]?.at;
    if (valueAt === undefined) return;
    const value = optionValue(command, valueAt);
    if (flag[1] === "-F" || flag[1] === "--file") fromStdin ||= value === "-";
    else if (flag[1] === "--trailer") {
      waived ||= WAIVER.test(value ?? "");
      if (value !== null) trailers.push(value);
    } else if (value !== null) parts.push(value);
  });
  if (parts.length === 0 && fromStdin) {
    HEREDOC.lastIndex = call.start;
    const doc = HEREDOC.exec(command);
    if (doc && doc.index < call.end) parts.push(doc[3] ?? "");
  }
  const message = parts.length > 0 ? parts.join("\n\n") : null;
  const body = message?.split("\n").slice(1).join("\n") ?? "";
  return { dir: call.dir, message, trailers, waived: waived || WAIVER.test(body) };
}
