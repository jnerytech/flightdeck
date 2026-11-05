/**
 * The rules behind the project's Claude Code hooks (.claude/hooks), kept here to be tested.
 * The hooks only read the tool call from stdin and apply these.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { auditBase, FORBIDDEN_MARKERS, parseCommits } from "./tdd-audit.ts";

/** git options that take their value as the next word (`git -C <dir> add`). */
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** Paths written by tools, relative to a checkout; a trailing slash means the whole folder. */
const GENERATED = [
  "bun.lock",
  "coverage/",
  "dist/",
  "node_modules/",
  "release-assets/",
  "apps/desktop/dist/",
  "apps/desktop/src-tauri/gen/",
  "apps/desktop/src-tauri/target/",
];

const TEST_FILE = /\.test\.tsx?$/;

/** The audit's markers plus a snapshot, which on its first run records whatever the stub returns. */
const TEST_MARKERS = [
  ...FORBIDDEN_MARKERS,
  { pattern: /\.toMatchSnapshot\(/g, text: "toMatchSnapshot(" },
];

/** The command without heredoc bodies and quoted text, which are data, not commands. */
function commandWords(command: string): string {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, "")
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

/** The subcommand and its arguments of each git invocation in a (possibly chained) command. */
function gitInvocations(command: string): { sub: string; args: string[] }[] {
  const invocations: { sub: string; args: string[] }[] = [];
  for (const segment of commandWords(command).split(/[;&|\n]+/)) {
    const words = segment.trim().split(/\s+/);
    let i = words.indexOf("git");
    if (i < 0) continue;
    i++;
    while (words[i]?.startsWith("-")) i += GIT_OPTIONS_WITH_VALUE.has(words[i] ?? "") ? 2 : 1;
    invocations.push({ sub: words[i] ?? "", args: words.slice(i + 1) });
  }
  return invocations;
}

/** A cluster of short options (`-vA`) that includes one of `letters`. */
function hasShortFlag(arg: string, letters: string): boolean {
  return /^-[a-zA-Z]+$/.test(arg) && [...arg.slice(1)].some((letter) => letters.includes(letter));
}

/** Why a shell command is blocked (docs/TDD.md: stage by explicit path), or null. */
export function commandViolation(command: string): string | null {
  for (const { sub, args } of gitInvocations(command)) {
    if (sub === "add") {
      const wide = args.find(
        (a) => [".", "*", ":/", "--all", "--update"].includes(a) || hasShortFlag(a, "Au"),
      );
      if (wide) {
        return `git add ${wide} is blocked: stage files by explicit path and check git status --short first (docs/TDD.md).`;
      }
    }
    if (sub === "commit") {
      const all = args.find((a) => a === "--all" || hasShortFlag(a, "a"));
      if (all) {
        return `git commit ${all} is blocked: stage files by explicit path with git add <files> (docs/TDD.md).`;
      }
    }
  }
  return null;
}

/** Why editing a file is blocked because a tool writes it, or null. `relPath` is from its checkout. */
export function generatedViolation(relPath: string): string | null {
  const rel = relPath.replaceAll("\\", "/");
  const hit = GENERATED.find((g) => (g.endsWith("/") ? rel.startsWith(g) : rel === g));
  if (!hit) return null;
  return `${rel} is generated (${hit}): change its source or rerun the tool that writes it (bun install, the build, bun test).`;
}

const norm = (path: string) => resolve(path).replaceAll("\\", "/").toLowerCase();

/** The shared `.git` directory of the checkout at `dir`, or null if `dir` is not a checkout. */
function commonGitDir(dir: string): string | null {
  const dotGit = join(dir, ".git");
  if (!existsSync(dotGit)) return null;
  if (statSync(dotGit).isDirectory()) return norm(dotGit);
  const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
  // A linked worktree's gitdir is <common .git>/worktrees/<name>.
  return gitDir ? norm(resolve(dir, gitDir.trim(), "..", "..")) : null;
}

/**
 * The checkout a file belongs to: the main checkout or any linked worktree of the same
 * repository as `projectDir` (sessions run from the main checkout and edit the worktrees beside
 * it). Null for files outside every checkout of this repository.
 */
export function checkoutRoot(filePath: string, projectDir: string): string | null {
  const project = commonGitDir(projectDir);
  if (!project) return null;
  let dir = dirname(isAbsolute(filePath) ? filePath : resolve(projectDir, filePath));
  for (;;) {
    const common = commonGitDir(dir);
    if (common) return common === project ? dir : null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Why an Edit or Write of a test file is blocked: it adds a focused, skipped or todo test, or a
 * snapshot that would record the first run (docs/TDD.md). `readFile` gives the current content
 * of the file a Write replaces (null when it does not exist).
 */
export function testEditViolation(
  tool: string,
  input: Record<string, unknown>,
  readFile: (path: string) => string | null,
): string | null {
  const file = input.file_path;
  if (typeof file !== "string" || !TEST_FILE.test(file)) return null;
  const [before, after] =
    tool === "Write" ? [readFile(file) ?? "", input.content] : [input.old_string, input.new_string];
  if (typeof before !== "string" || typeof after !== "string") return null;
  const added = TEST_MARKERS.find(
    ({ pattern }) => (after.match(pattern)?.length ?? 0) > (before.match(pattern)?.length ?? 0),
  );
  if (!added) return null;
  return `Adding ${added.text} to ${file} is blocked: committed tests have no .only, .skip, test.todo or first-run toMatchSnapshot (docs/TDD.md). Write the assertion with a hand-written literal.`;
}

export interface CommitGateDeps {
  /** Runs git with these arguments in `cwd`; null when git fails. */
  git: (args: string[], cwd: string) => string | null;
}

/**
 * Why the `git commit` in `command` is blocked: its subject is not `type(scope): text`, a
 * feat/fix has no scope, or a feat(x)/fix(x) has no earlier test(x) since the audit base
 * (docs/TDD.md). `cwd` is where the shell starts. Anything it cannot read (a message from an
 * editor or a file, a quoted directory, git failing) passes: the audit and CI still check it.
 */
export function commitViolation(command: string, cwd: string, deps: CommitGateDeps): string | null {
  const dir = commitDir(command, cwd);
  if (dir === undefined) return null;
  const subject = commitSubject(command);
  if (subject === null || /^(Merge|Revert) /.test(subject)) return null;
  const match = SUBJECT.exec(subject);
  if (!match) {
    return `Commit subject "${subject}" is blocked: write type(scope): text, with type one of ${COMMIT_TYPES.join(", ")} (docs/TDD.md).`;
  }
  const [, type, scope] = match;
  if (type !== "feat" && type !== "fix") return null;
  if (!scope) {
    return `${type} needs a scope: ${type}(<area>): text, the same scope as its earlier test(<area>) commit (docs/TDD.md).`;
  }
  if (/(?:^|\s)FLIGHTDECK_TDD_WAIVER=/.test(commandWords(command)) || dir === null) return null;
  const git = (args: string[]) => deps.git(args, dir);
  const base = auditBase(git);
  if (base === null) return null;
  const log = git(["log", "--format=%H%x1f%s", `${base}..HEAD`]);
  if (log === null) return null;
  if (parseCommits(log).some((c) => c.type === "test" && c.scope === scope)) return null;
  return `${type}(${scope}) is blocked: no earlier test(${scope}) commit since ${base} (docs/TDD.md: commit the failing test first). For a deliberate exception, prefix the command with FLIGHTDECK_TDD_WAIVER="<why>" and add the commit to scripts/tdd-audit-waivers.json right after.`;
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
const SUBJECT = new RegExp(`^(${COMMIT_TYPES.join("|")})(?:\\(([^)]+)\\))?!?: \\S`);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2\s*(?=\n|\)|$)/;
const MESSAGE_FLAG = /(?:^|\s)(?:-m|--message)(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']\S*)/;
const STDIN_FILE = /(?:^|\s)(?:-F|--file)(?:=|\s+)-(?=\s|$)/;

/** The first line of the message the command commits with, or null when it cannot be read. */
function commitSubject(command: string): string | null {
  const flag = MESSAGE_FLAG.exec(command)?.[1];
  let message: string | undefined;
  if (flag?.startsWith('"$(')) message = HEREDOC.exec(flag)?.[3];
  else if (flag?.startsWith('"')) message = flag.slice(1, -1).replace(/\\(.)/g, "$1");
  else if (flag?.startsWith("'")) message = flag.slice(1, -1);
  else if (flag) message = flag;
  else if (STDIN_FILE.test(command)) message = HEREDOC.exec(command)?.[3];
  const first = message?.split("\n").find((line) => line.trim() !== "");
  return first === undefined ? null : first.trim();
}

/**
 * The directory the command's `git commit` runs in: the shell's, moved by each `cd` before it and
 * by `git -C`. Null when a directory is quoted (its words are hidden from the parse), undefined
 * when the command commits nothing.
 */
function commitDir(command: string, cwd: string): string | null | undefined {
  let dir = cwd;
  for (const segment of commandWords(command).split(/[;&|\n]+/)) {
    const words = segment.trim().split(/\s+/);
    if (words[0] === "cd") {
      const target = words[1];
      if (!target || target.includes('"')) return null;
      dir = resolve(dir, target);
      continue;
    }
    let i = words.indexOf("git");
    if (i < 0) continue;
    let at = dir;
    for (i++; words[i]?.startsWith("-"); i += GIT_OPTIONS_WITH_VALUE.has(words[i] ?? "") ? 2 : 1) {
      if (words[i] !== "-C") continue;
      const target = words[i + 1];
      if (!target || target.includes('"')) return null;
      at = resolve(dir, target);
    }
    if (words[i] === "commit") return at;
  }
  return undefined;
}
