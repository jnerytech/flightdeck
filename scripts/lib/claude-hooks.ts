/**
 * The rules behind the project's Claude Code hooks (.claude/hooks), kept here to be tested.
 * The hooks only read the tool call from stdin and apply these.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { auditBase, FORBIDDEN_MARKERS, parseCommits } from "./tdd-audit.ts";
import { undocumentedSkips } from "./unstable-skip.ts";

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

/** `git add` of everything at once (`.`, `*`, `--all`, `-A`...). */
function addViolation(args: string[]): string | null {
  const wide = args.find(
    (a) => [".", "*", ":/", "--all", "--update"].includes(a) || hasShortFlag(a, "Au"),
  );
  if (!wide) return null;
  return `git add ${wide} is blocked: stage files by explicit path and check git status --short first (docs/TDD.md).`;
}

/** `git stash` in any form but `list` and `show`: the stash is shared across worktrees. */
function stashViolation(args: string[]): string | null {
  if (["list", "show"].includes(args[0] ?? "")) return null;
  const what = args[0] && !args[0].startsWith("-") ? `git stash ${args[0]}` : "git stash";
  return `${what} is blocked: refs/stash is shared across worktrees; use git diff > /tmp/<name>.patch + git apply, or a WIP commit on your branch.`;
}

/** `git commit -a` / `--all`. */
function commitAllViolation(args: string[]): string | null {
  const all = args.find((a) => a === "--all" || hasShortFlag(a, "a"));
  if (!all) return null;
  return `git commit ${all} is blocked: stage files by explicit path with git add <files> (docs/TDD.md).`;
}

const GIT_RULES: Record<string, (args: string[]) => string | null> = {
  add: addViolation,
  stash: stashViolation,
  commit: commitAllViolation,
};

/** Why a shell command is blocked (docs/TDD.md: stage by explicit path), or null. */
export function commandViolation(command: string): string | null {
  for (const { sub, args } of gitInvocations(command)) {
    const violation = Object.hasOwn(GIT_RULES, sub) ? GIT_RULES[sub]?.(args) : null;
    if (violation) return violation;
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

/**
 * The shared `.git` directory of the checkout at `dir`, spelled as the filesystem has it, or null
 * if `dir` is not a checkout.
 */
export function gitCommonDir(dir: string): string | null {
  const dotGit = join(dir, ".git");
  if (!existsSync(dotGit)) return null;
  if (statSync(dotGit).isDirectory()) return dotGit;
  const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
  // A linked worktree's gitdir is <common .git>/worktrees/<name>.
  return gitDir ? resolve(dir, gitDir.trim(), "..", "..") : null;
}

/** The same directory, normalized for comparison. */
function commonGitDir(dir: string): string | null {
  const common = gitCommonDir(dir);
  return common ? norm(common) : null;
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
  if (!added) {
    if (undocumentedSkips(after) <= undocumentedSkips(before)) return null;
    return `Adding a skipIf that skips off Linux to ${file} is blocked: it needs \`// unstable: #<issue> <reason>\` on the same line or the line above, and the fix goes to that issue (docs/TDD.md).`;
  }
  return `Adding ${added.text} to ${file} is blocked: committed tests have no .only, .skip, test.todo or first-run toMatchSnapshot (docs/TDD.md). Write the assertion with a hand-written literal.`;
}

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
  if (!commit || commit.message === null) return null;
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
const SUBJECT = new RegExp(`^(${COMMIT_TYPES.join("|")})(?:\\(([^)]+)\\))?!?: \\S`);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2[ \t]*(?=\n|\)|$)/g;
const WAIVER = /^TDD-Waiver:[ \t]*\S/m;

/**
 * The command with heredoc bodies and the inside of quoted strings blanked to spaces, so every
 * offset still points at the same character of the original: words found here are commands, and
 * the values they take are read from the original at the same place.
 */
function maskCommand(command: string): string {
  const blank = (text: string) => " ".repeat(text.length);
  return command
    .replace(HEREDOC, (whole: string) => {
      const head = whole.indexOf("\n") + 1;
      return whole.slice(0, head) + blank(whole.slice(head));
    })
    .replace(
      /"(?:[^"\\]|\\.)*"|'[^']*'/g,
      (quoted) => `${quoted[0]}${blank(quoted.slice(1, -1))}${quoted[0]}`,
    );
}

/** The value of an option that starts at `at` in the original command. */
function optionValue(command: string, at: number): string | null {
  if (command.startsWith('"$(', at)) {
    HEREDOC.lastIndex = 0;
    return HEREDOC.exec(command.slice(at))?.[3] ?? null;
  }
  const quoted = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/y;
  quoted.lastIndex = at;
  const m = quoted.exec(command);
  if (!m) return null;
  return m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3] ?? null);
}

interface GitCall {
  /** The subcommand (`commit`, `push`, ...). */
  sub: string;
  /** Where it runs; null when a directory is quoted (its words are hidden from the parse). */
  dir: string | null;
  /** The words after the subcommand, from the masked command, with their offsets. */
  args: { word: string; at: number }[];
  /** The masked segment's start and end in the command. */
  start: number;
  end: number;
}

/** The folder a `cd` or `git -C` goes to; null when it cannot be told (nowhere known, nothing or a quoted word). */
function enter(dir: string | null, target: string): string | null {
  return dir === null || !target || target.includes('"') ? null : resolve(dir, target);
}

/** Each git invocation in the command, with its directory (each `cd` before it, `git -C`). */
function gitCalls(command: string, cwd: string): GitCall[] {
  const calls: GitCall[] = [];
  let dir: string | null = cwd;
  for (const segment of maskCommand(command).matchAll(/[^;&|\n]+/g)) {
    const tokens = [...segment[0].matchAll(/\S+/g)].map((t) => ({
      word: t[0],
      at: segment.index + t.index,
    }));
    const word = (i: number) => tokens[i]?.word ?? "";
    if (word(0) === "cd") {
      dir = enter(dir, word(1));
      continue;
    }
    const found = tokens.findIndex((t) => t.word === "git");
    if (found < 0) continue;
    let at = dir;
    let i = found + 1;
    for (; word(i).startsWith("-"); i += GIT_OPTIONS_WITH_VALUE.has(word(i)) ? 2 : 1) {
      if (word(i) === "-C") at = enter(at, word(i + 1));
    }
    calls.push({
      sub: word(i),
      dir: at,
      args: tokens.slice(i + 1),
      start: segment.index,
      end: segment.index + segment[0].length,
    });
  }
  return calls;
}

interface FoundCommit {
  /** Where it runs; null when a directory is quoted. */
  dir: string | null;
  /** The whole message, or null when the command gives none it can read. */
  message: string | null;
  waived: boolean;
}

/** The command's `git commit`: its directory and its message. */
function findCommit(command: string, cwd: string): FoundCommit | undefined {
  const call = gitCalls(command, cwd).find((c) => c.sub === "commit");
  if (!call) return undefined;
  const parts: string[] = [];
  let waived = false;
  let fromStdin = false;
  call.args.forEach(({ word: w, at: pos }, j) => {
    const flag = /^(-m|--message|--trailer|-F|--file)(=)?/.exec(w);
    if (!flag) return;
    const valueAt = flag[2] ? pos + flag[0].length : call.args[j + 1]?.at;
    if (valueAt === undefined) return;
    const value = optionValue(command, valueAt);
    if (flag[1] === "-F" || flag[1] === "--file") fromStdin ||= value === "-";
    else if (flag[1] === "--trailer") waived ||= WAIVER.test(value ?? "");
    else if (value !== null) parts.push(value);
  });
  if (parts.length === 0 && fromStdin) {
    HEREDOC.lastIndex = call.start;
    const doc = HEREDOC.exec(command);
    if (doc && doc.index < call.end) parts.push(doc[3] ?? "");
  }
  const message = parts.length > 0 ? parts.join("\n\n") : null;
  const body = message?.split("\n").slice(1).join("\n") ?? "";
  return { dir: call.dir, message, waived: waived || WAIVER.test(body) };
}

/**
 * Why a heavy run (the full suite, e2e, the prints, the smokes, the builds) is blocked outside
 * `bun run slot --` (CLAUDE.md: two at once make the timing tests flaky). `env` is the hook's own
 * environment: under a slot holder (`FLIGHTDECK_SLOT_HOLDER`) the run is already in the slot.
 */
export function slotViolation(
  command: string,
  env: Record<string, string | undefined>,
): string | null {
  if (env.FLIGHTDECK_SLOT_HOLDER) return null;
  for (const segment of commandWords(command).split(/[;&|\n]+/)) {
    const words = segment.trim().split(/\s+/);
    const i = words.indexOf("bun");
    if (i < 0) continue;
    const run = words[i + 1] === "run" ? words[i + 2] : undefined;
    if (run === "slot") continue;
    // `bun test` with no file is the whole suite.
    const wholeSuite =
      words[i + 1] === "test" && words.slice(i + 2).every((w) => w.startsWith("-"));
    if (!wholeSuite && !(run && HEAVY.test(run))) continue;
    const heavy = words.slice(i).join(" ");
    return `${heavy} is heavy: run it through the slot, \`bun run slot -- ${heavy}\` (CLAUDE.md: two heavy runs at once make the timing tests flaky).`;
  }
  return null;
}

/** The package scripts that run only through the slot (CLAUDE.md). */
const HEAVY = /^(test|coverage|e2e|demo:shots|smoke(:[\w-]+)?|build:(daemon|desktop))$/;

/**
 * Why a `bun run pr -- merge|tag`, a `gh pr merge` or a REST merge is blocked (#271): sessions
 * open their PRs and turn on auto-merge; merging by hand and tagging are the coordinator's
 * (`FLIGHTDECK_COORDINATOR=1` in the hook's own environment, not one set in the command).
 */
export function prMergeViolation(
  command: string,
  env: Record<string, string | undefined>,
): string | null {
  if (env.FLIGHTDECK_COORDINATOR) return null;
  for (const segment of commandWords(command).split(/[;&|\n]+/)) {
    const what = handMerge(segment.trim().split(/\s+/));
    if (what) {
      return `${what} is the coordinator's: a session opens its PR and turns on auto-merge, \`bun run pr -- auto <n>\` (CLAUDE.md).`;
    }
  }
  return null;
}

/** The hand merge or tag one command's words run, or null. */
function handMerge(words: string[]): string | null {
  const g = words.indexOf("gh");
  if (g >= 0 && words[g + 1] === "pr" && words[g + 2] === "merge") return "gh pr merge";
  if (g >= 0 && words[g + 1] === "api" && words.some((w) => /\/pulls\/\d+\/merge$/.test(w))) {
    return "a REST merge";
  }
  const sub = prFlowCommand(words);
  return sub === "merge" || sub === "tag" ? `bun run pr -- ${sub}` : null;
}

/** The `bun run pr` (or `bun scripts/pr-flow.ts`) command these words run, or undefined. */
function prFlowCommand(words: string[]): string | undefined {
  const b = words.indexOf("bun");
  if (b < 0) return undefined;
  const rest = words.slice(b + 1);
  let at = -1;
  if (rest[0] === "run" && rest[1] === "pr") at = 2;
  else if (rest[0]?.endsWith("pr-flow.ts")) at = 1;
  return at < 0 ? undefined : rest.slice(at).find((w) => w !== "--");
}

export interface PushGuardDeps extends CommitGateDeps {
  /** The hook's own environment: `FLIGHTDECK_COORDINATOR=1` marks the session that may push all. */
  env: Record<string, string | undefined>;
}

/**
 * Why a `git push` is blocked (#218): sessions push only their own work branches. Pushing main,
 * an rc/* branch or a tag, `--tags`/`--all`/`--mirror`, a bare `--force` or a `+` refspec, and a
 * `--force-with-lease` to any branch but the one checked out are blocked. The coordinator
 * (`FLIGHTDECK_COORDINATOR=1` in the hook's environment) and other repositories pass.
 */
export function pushViolation(command: string, cwd: string, deps: PushGuardDeps): string | null {
  if (deps.env.FLIGHTDECK_COORDINATOR) return null;
  for (const call of gitCalls(command, cwd)) {
    if (call.sub !== "push" || call.dir === null) continue;
    if (deps.inProject && !deps.inProject(call.dir)) continue;
    const dir = call.dir;
    const reason = pushRuleViolation(
      call.args.map((a) => a.word),
      (args) => deps.git(args, dir),
    );
    if (reason) return reason;
  }
  return null;
}

const OWN_BRANCHES =
  "sessions push only their own work branches; the coordinator pushes main, rc/* and tags (CLAUDE.md).";
/** `git push` options that take their value as the next word. */
const PUSH_OPTIONS_WITH_VALUE = new Set([
  "-o",
  "--push-option",
  "--repo",
  "--receive-pack",
  "--exec",
]);

interface PushWords {
  /** The refusal for a flag that is blocked outright (`--tags`, `--mirror`...). */
  blocked: string | null;
  positional: string[];
  bareForce: boolean;
  lease: boolean;
  deleting: boolean;
}

/** The words after `git push`, sorted into the remote and refspecs, and the flags the rules look at. */
function readPushWords(args: string[]): PushWords {
  const words: PushWords = {
    blocked: null,
    positional: [],
    bareForce: false,
    lease: false,
    deleting: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a.includes('"') || a.includes("'")) continue;
    if (["--tags", "--all", "--mirror", "--follow-tags"].includes(a)) {
      return { ...words, blocked: `git push ${a} is blocked: ${OWN_BRANCHES}` };
    }
    if (a === "-f" || a === "--force") words.bareForce = true;
    else if (a.startsWith("--force-with-lease") || a === "--force-if-includes") words.lease = true;
    else if (a === "-d" || a === "--delete") words.deleting = true;
    else if (PUSH_OPTIONS_WITH_VALUE.has(a)) i++;
    else if (!a.startsWith("-")) words.positional.push(a);
  }
  return words;
}

type PushTarget = { dst: string | null; tag: boolean; plus: boolean };

/** Where one refspec pushes to: the branch (or tag) it names, and whether it forces with a `+`. */
function pushTarget(
  spec: string,
  deleting: boolean,
  current: string | null,
  git: (args: string[]) => string | null,
): PushTarget {
  const plus = spec.startsWith("+");
  const bare = plus ? spec.slice(1) : spec;
  const colon = bare.indexOf(":");
  const src = colon < 0 ? bare : bare.slice(0, colon);
  let dst = deleting || colon < 0 ? bare : bare.slice(colon + 1);
  if (dst.startsWith("refs/tags/")) return { dst, tag: true, plus };
  dst = dst.replace(/^refs\/heads\//, "");
  if (dst === "HEAD") return { dst: current, tag: false, plus };
  const tag =
    colon < 0 && !deleting && git(["show-ref", "--verify", "--quiet", `refs/tags/${src}`]) !== null;
  return { dst, tag, plus };
}

/** Why one push target is refused (a tag, main or an rc branch, a force, a lease elsewhere), or null. */
function targetViolation(target: PushTarget, words: PushWords, current: string | null) {
  const { dst, tag, plus } = target;
  if (tag) return `git push of the tag ${dst} is blocked: ${OWN_BRANCHES}`;
  if (dst === null) return null;
  if (dst === "main" || dst.startsWith("rc/")) {
    return `git push to ${dst} is blocked: ${OWN_BRANCHES}`;
  }
  if (words.bareForce || plus) {
    return `git push --force is blocked: use --force-with-lease, and only on the branch checked out here (${current ?? "none"}).`;
  }
  if (words.lease && dst !== current) {
    return `git push --force-with-lease to ${dst} is blocked: force only the branch checked out here (${current ?? "none"}); ${OWN_BRANCHES}`;
  }
  return null;
}

/** The rules of `pushViolation` for one `git push` with these words after `push`. */
function pushRuleViolation(args: string[], git: (args: string[]) => string | null): string | null {
  const words = readPushWords(args);
  if (words.blocked) return words.blocked;
  const current = git(["symbolic-ref", "--short", "HEAD"])?.trim() || null;
  const refspecs = words.positional.slice(1);
  const targets: PushTarget[] =
    refspecs.length === 0
      ? [{ dst: current, tag: false, plus: false }]
      : refspecs.map((spec) => pushTarget(spec, words.deleting, current, git));
  for (const target of targets) {
    const violation = targetViolation(target, words, current);
    if (violation) return violation;
  }
  return null;
}
