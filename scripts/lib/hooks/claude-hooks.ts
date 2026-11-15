/**
 * The rules behind the project's Claude Code hooks (.claude/hooks), kept here to be tested.
 * The hooks only read the tool call from stdin and apply these.
 */
import { existsSync, lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { FORBIDDEN_MARKERS, uncommentedOffLinux } from "../guards/tdd-audit.ts";
import { assertionCounts, weakensAssertions } from "../guards/weak-assert.ts";
import { HEAVY_TESTS, heavyReasonGiven, heavyRunMessage } from "../slot/heavy.ts";
import type { CommitGateDeps } from "./commit-rules.ts";
import { commitWaived } from "./commit-rules.ts";
import { printable, redacted } from "./redact.ts";
import type { GitCall } from "./shell-parse.ts";
import {
  gitCalls,
  prefixAssignment,
  rawSegments,
  shellWords,
  withoutHeredocs,
} from "./shell-parse.ts";

export { commitViolation, commitWaived } from "./commit-rules.ts";
export { blockDetail, printable } from "./redact.ts";

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

/**
 * The audit's markers, so both refuse the same skips (#169), plus a snapshot, which on its first
 * run records whatever the stub returns: the audit reads files, not runs, so only the hook sees it.
 */
const TEST_MARKERS = [
  ...FORBIDDEN_MARKERS,
  { pattern: /\.toMatchSnapshot\(/g, text: "toMatchSnapshot(" },
];

/** The command without heredoc bodies and quoted text, which are data, not commands. */
function commandWords(command: string): string {
  return withoutHeredocs(command).replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

/** The subcommand and its arguments of each git invocation in a (possibly chained) command. */
function gitInvocations(command: string): { sub: string; args: string[] }[] {
  // The same reading as the push and commit gates (#759): a quoted option value is one word, and a
  // word that is all one quoted string reads as its text.
  return gitCalls(command, "/").map((call) => ({
    sub: call.sub,
    args: call.args.map((a) => a.value),
  }));
}

/** A cluster of short options (`-vA`) that includes one of `letters`. */
function hasShortFlag(arg: string, letters: string): boolean {
  const flags = [...arg.slice(1)]; // NOSONAR: a string spread into its letters, no array cloned
  return /^-[a-zA-Z]+$/.test(arg) && flags.some((letter) => letters.includes(letter));
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
  const gitDir = /^gitdir:[ \t]*(\S.*)$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
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

/** What the biome-on-edit hook found in the file it checked: `ok` when nothing is left to fix. */
export interface EditedFileCheck {
  ok: boolean;
  output: string;
}

/** Whether the file still holds exactly these bytes (it can be gone or changed while Biome runs). */
function sameBytes(file: string, bytes: Buffer): boolean {
  try {
    return readFileSync(file).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * The biome-on-edit hook's check of one edited file (#1566): formatting, import order and safe
 * fixes are written into the file, and what is left is returned.
 *
 * `biome check <file>` scans the whole project before it checks one file, 3 to 13 s per edit. Two
 * runs do not: `check --write` over stdin (it fixes, it does not report) and `lint` with the
 * `project` and `types` domains skipped. Those domains hold the two type-aware rules
 * (noFloatingPromises, useArraySortCompare), which stay in `bun run lint`, run by CI and by
 * `handoff:check`. `biome` is the command that starts Biome, `bun x biome` by default.
 */
export function checkEditedFile(
  root: string,
  rel: string,
  biome: string[] = ["bun", "x", "biome"],
): EditedFileCheck {
  const run = (args: string[], input?: string) => {
    const proc = Bun.spawnSync([...biome, ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      ...(input === undefined ? {} : { stdin: Buffer.from(input) }),
    });
    return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
  };
  const file = join(root, rel);
  let bytes: Buffer;
  try {
    // A symlink is not written through, and a file that is gone has nothing to report.
    if (lstatSync(file).isSymbolicLink()) return { ok: true, output: "" };
    bytes = readFileSync(file);
  } catch {
    return { ok: true, output: "" };
  }
  const before = bytes.toString("utf8");
  const fixed = run(["check", "--write", `--stdin-file-path=${rel}`], before);
  // Only a file that still holds what Biome was given (valid UTF-8, no edit since) is replaced.
  if (
    fixed.code === 0 &&
    fixed.out !== "" &&
    fixed.out !== before &&
    Buffer.from(before).equals(bytes) &&
    sameBytes(file, bytes)
  ) {
    writeFileSync(file, fixed.out);
  }
  const left = run([
    "lint",
    "--skip=project",
    "--skip=types",
    "--no-errors-on-unmatched",
    "--files-ignore-unknown=true",
    "--",
    rel,
  ]);
  if (left.code === 0) return { ok: true, output: "" };
  return { ok: false, output: `${left.out}${left.err}`.trim() };
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
  const edit = testEditTexts(tool, input, readFile);
  if (!edit) return null;
  const { file, before, after } = edit;
  const added = TEST_MARKERS.find(
    ({ pattern }) => [...after.matchAll(pattern)].length > [...before.matchAll(pattern)].length,
  );
  if (!added) {
    if (uncommentedOffLinux(after).length <= uncommentedOffLinux(before).length) return null;
    return `Adding a skipIf off Linux to ${file} is blocked: give its platform reason in a comment on its line or the line above. A flaky test is deleted, never skipped (#1003, docs/TDD.md).`;
  }
  if (added.text === ".skip(") {
    return `Adding a skip to ${file} is blocked: a flaky test is deleted, never skipped (#1003); when it is the only check of a business flow, replace it with a fast deterministic test. A test that cannot run on a platform uses skipIf(<the platform condition>), with the reason in a comment (docs/TDD.md).`;
  }
  return `Adding ${added.text} to ${file} is blocked: committed tests have no .only, test.todo or first-run toMatchSnapshot, and no .skip: a flaky test is deleted, never skipped (#1003). Write the assertion with a hand-written literal (docs/TDD.md).`;
}

/**
 * Why an Edit or Write of a test file is blocked for weakening an assertion (#1141): within the
 * edit, strict matchers go down and weak ones go up (`weakensAssertions`).
 */
export function weakAssertViolation(
  tool: string,
  input: Record<string, unknown>,
  readFile: (path: string) => string | null,
): string | null {
  const edit = testEditTexts(tool, input, readFile);
  if (!edit || !weakensAssertions(edit.before, edit.after)) return null;
  return `Editing ${edit.file} weakens an assertion: a strict matcher (toBe, toEqual, toContain, toMatch…) became a weak one (toBeDefined, toBeTruthy, not.toBeNull…). Keep the strict check; when the weaker one is right, put "// weaker: <why>" on its line, and the hook logs it (docs/TDD.md, #1141).`;
}

/** The reason of a `// weaker: <why>` line the edit adds, for the hook log's waivers; else null. */
export function weakerEscape(
  tool: string,
  input: Record<string, unknown>,
  readFile: (path: string) => string | null,
): string | null {
  const edit = testEditTexts(tool, input, readFile);
  if (!edit) return null;
  if (assertionCounts(edit.after).escaped <= assertionCounts(edit.before).escaped) return null;
  // Logged only when the escape let the edit through (#1143 review): without it, it would block.
  const unescaped = edit.after.replace(/\/\/ weaker: [^\r\n]*/g, "");
  if (!weakensAssertions(edit.before, unescaped)) return null;
  const old = new Set(edit.before.split(/\r?\n/));
  const added = edit.after.split(/\r?\n/).filter((line) => !old.has(line));
  const reason = added.map((line) => /\/\/ weaker: (\S.*)$/.exec(line)?.[1]).find(Boolean);
  // Cut, so a long comment never fills the hook log (security review).
  return reason ? reason.trim().slice(0, 200) : null;
}

/** The test file an Edit or Write touches, with its text before and after; null for any other file. */
function testEditTexts(
  tool: string,
  input: Record<string, unknown>,
  readFile: (path: string) => string | null,
): { file: string; before: string; after: string } | null {
  const file = input.file_path;
  if (typeof file !== "string" || !TEST_FILE.test(file)) return null;
  const [before, after] =
    tool === "Write" ? [readFile(file) ?? "", input.content] : [input.old_string, input.new_string];
  if (typeof before !== "string" || typeof after !== "string") return null;
  return { file, before, after };
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

/** The coverage scripts by the names a command may give them: the package script or its file. */
const COVERAGE_SCRIPTS: Record<string, string> = {
  "test:related": "test:related",
  "scripts/test-related.ts": "test:related",
  "coverage:funcs": "coverage:funcs",
  "scripts/coverage-funcs.ts": "coverage:funcs",
};

/** The flags of `bun` and `bun run` that take the next word as their value. */
const BUN_VALUE_FLAGS = new Set(["--cwd", "--config", "-c", "--env-file", "--preload", "-r"]);

/**
 * The coverage script a command starts at word `i`, with its arguments: `bun [run] [flags] <name>`
 * (with bun's shorthand) or `npm run [flags] <name>`, where the name is the package script or its
 * file (#687). The name is the first word after the flags and their values, so a script file given
 * to another script (`bun run lint scripts/test-related.ts`) is no run of it.
 */
function coverageScriptAt(words: string[], i: number): { script: string; args: string[] } | null {
  const npm = words[i] === "npm" && words[i + 1] === "run";
  if (words[i] !== "bun" && !npm) return null;
  let at = npm ? i + 2 : i + 1;
  while (at < words.length && (words[at]?.startsWith("-") || (!npm && words[at] === "run"))) {
    at += BUN_VALUE_FLAGS.has(words[at] as string) ? 2 : 1;
  }
  const script = COVERAGE_SCRIPTS[(words[at] ?? "").replace(/^\.\//, "")];
  return script ? { script, args: words.slice(at + 1) } : null;
}

/**
 * Every full coverage run a command starts, through the slot or not, each with the override in
 * front of its own segment (#687: an override elsewhere in the command, or in front of another
 * heavy run, does not count). It reads the first coverage script of each segment only: a run
 * inside `bash -c`, `xargs` or `$(...)` counts once at most, or not at all when quoted.
 */
function heavyRuns(command: string): Array<{ what: string; override: string | undefined }> {
  const runs: Array<{ what: string; override: string | undefined }> = [];
  for (const segment of rawSegments(command)) {
    const words = shellWords(segment);
    const start = words.findIndex((_, i) => coverageScriptAt(words, i) !== null);
    if (start < 0) continue;
    const found = coverageScriptAt(words, start) as { script: string; args: string[] };
    const override = prefixAssignment(segment, "FLIGHTDECK_SLOT_HEAVY");
    // The script's own check reads its environment, which an assignment in the command sets, in
    // front of it or after a wrapper such as `env` or `slot --` (#687).
    if (words.slice(0, start).some((word) => /^["']?FLIGHTDECK_COORDINATOR=/.test(word))) {
      runs.push({
        what: `FLIGHTDECK_COORDINATOR set in the command (only the coordinator's own environment marks the coordinator) with ${found.script}`,
        override,
      });
      continue;
    }
    const what = heavyScript(found.script, found.args);
    if (what) runs.push({ what, override });
  }
  return runs;
}

/** How many test files every `--tests` names: Infinity for a glob or a command's output (#687). */
function testsGiven(args: string[]): number {
  const given: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith("--tests=")) given.push(...arg.slice("--tests=".length).split(","));
    if (arg !== "--tests") continue;
    while (i + 1 < args.length && !(args[i + 1] as string).startsWith("-")) {
      given.push(args[++i] as string);
    }
  }
  // * ? [ $ or ` stand for an unknown number of files, quoted or not: the script takes no glob.
  const unbounded = given.some((a) => /[*?[$`]/.test(a));
  return unbounded ? Number.POSITIVE_INFINITY : given.filter((a) => a !== "").length;
}

/** Whether a coverage script with these arguments is a full coverage run, and how to name it. */
function heavyScript(script: string, args: string[]): string | null {
  if (script === "test:related") {
    const light = args.some((a) => a === "--fast" || a === "--tier" || a.startsWith("--tier="));
    return args.includes("--pr") || !light
      ? "a plain, --base or --pr `bun run test:related`"
      : null;
  }
  const given = testsGiven(args);
  if (given === Number.POSITIVE_INFINITY) {
    return "`bun run coverage:funcs` over a glob or a command's output after --tests";
  }
  return given > HEAVY_TESTS ? `\`bun run coverage:funcs\` over ${given} test files` : null;
}

/**
 * Why a worker session's full coverage run is refused (#674): a plain, `--base` or `--pr`
 * `test:related`, or a `coverage:funcs` over more than 20 given test files, holds the shared slot
 * for 12 to 25 minutes for what the PR's CI does anyway. The coordinator
 * (`FLIGHTDECK_COORDINATOR=1` in the hook's environment) and an override with a reason pass;
 * coverage:funcs's own limit still asks the coordinator for a reason (#725).
 */
export function heavyRunViolation(
  command: string,
  env: Record<string, string | undefined>,
): string | null {
  if (env.FLIGHTDECK_COORDINATOR) return null;
  const heavy = heavyRuns(command).find((run) => !heavyReasonGiven(run.override));
  if (!heavy) return null;
  if (heavy.override === undefined) return heavyRunMessage(heavy.what);
  return `FLIGHTDECK_SLOT_HEAVY needs a reason: give the reason as the value. ${heavyRunMessage(heavy.what)}`;
}

/** Whether a refused heavy run goes ahead on an override that gives its reason (#674). */
export function heavyRunWaived(command: string): boolean {
  const runs = heavyRuns(command);
  return runs.length > 0 && runs.every((run) => heavyReasonGiven(run.override));
}

/**
 * What the guard logs for a call it lets through (#687): its waivers, or one allow, never both, so
 * harness:stats counts the call once. A call that both waives a heavy run and commits with a
 * TDD-Waiver logs the two waivers.
 */
export function guardAllowLogs(
  command: string | undefined,
  env: Record<string, string | undefined>,
  push?: { cwd: string; deps: PushWaitDeps },
  passes: PushWaitPass[] = [],
): Array<{ rule: string | null; decision: "allow" | "waived"; detail?: string; minutes?: number }> {
  const waived: Array<{ rule: string; decision: "waived"; detail?: string; minutes?: number }> = [];
  if (typeof command === "string") {
    // The coordinator passes the heavy-run rule without an override: there is no waiver to count.
    if (!env.FLIGHTDECK_COORDINATOR && heavyRunWaived(command)) {
      waived.push({ rule: "slot-heavy", decision: "waived" });
    }
    if (commitWaived(command)) waived.push({ rule: "commit", decision: "waived" });
    const override = env.FLIGHTDECK_COORDINATOR ? null : pushNowOverride(command, push);
    if (override) waived.push({ rule: "push-wait", decision: "waived", ...override });
  }
  if (waived.length > 0) return waived;
  // #741: a push the rule let through logs why, in place of the plain allow.
  if (passes.length > 0) {
    return passes.map(({ reason, minutes }) => ({
      rule: "push-wait",
      decision: "allow" as const,
      detail: reason,
      ...(minutes === undefined ? {} : { minutes }),
    }));
  }
  return [{ rule: null, decision: "allow" }];
}

/** The package scripts that run only through the slot (CLAUDE.md). */
const HEAVY =
  /^(test|coverage|fast-coverage|e2e|demo:shots|smoke(:[\w-]+)?|build:(daemon|desktop))$/;

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
  if (releaseCommand(words)) return "bun run release";
  if (releaseCloseApply(words)) return "bun run release:close --apply";
  const sub = prFlowCommand(words);
  return sub === "merge" || sub === "tag" ? `bun run pr -- ${sub}` : null;
}

/** True for `bun run release` (or `bun scripts/release-cmd.ts`): it pushes a branch and tags (#275). */
function releaseCommand(words: string[]): boolean {
  const b = words.indexOf("bun");
  if (b < 0) return false;
  const [first, second] = words.slice(b + 1);
  return (first === "run" && second === "release") || (first?.endsWith("release-cmd.ts") ?? false);
}

/** True for `bun run release:close ... --apply` (or `bun scripts/release-close.ts ...`): it closes issues on GitHub (#287). */
function releaseCloseApply(words: string[]): boolean {
  const b = words.indexOf("bun");
  if (b < 0) return false;
  const [first, second] = words.slice(b + 1);
  const closes =
    (first === "run" && second === "release:close") ||
    (first?.endsWith("release-close.ts") ?? false);
  return closes && words.includes("--apply");
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
      call.args.map((a) => a.value),
      (args) => deps.git(args, dir),
    );
    if (reason) return reason;
  }
  return null;
}

/** The latest pull-request CI run of a branch, as the push-wait rule reads it (#741). */
export interface PrRun {
  id: number;
  /** The run's page on GitHub. */
  url: string;
  inProgress: boolean;
  /** A check of the PR has failed already (#756 review: then the push is a fix). */
  failed: boolean;
  /** The PR conflicts with its base (#756 review: the merge of main must go out). */
  conflicting: boolean;
  /** Minutes since the run started. */
  minutes: number;
  /** #1541: the PR's auto-merge is off, so the run decides nothing; absent when on or unknown. */
  autoMergeOff?: boolean;
}

/** A branch's latest PR run, "none" when it has none, null when GitHub cannot be read. */
export type PrRunAnswer = PrRun | "none" | null;

export interface PushWaitDeps extends PushGuardDeps {
  /** The branch's latest PR run, read in `dir`: "none" when it has none, null when GitHub cannot be read. */
  prRun: (branch: string, dir: string) => PrRunAnswer;
  /** Why no lookup could answer (gh missing, no time left), which lets the push go; null holds it. */
  whyUnread?: () => string | null;
}

/** Why push-wait let a push through to one branch (#741: logged, so the passes can be read). */
export interface PushWaitPass {
  reason: string;
  /** The age of an old run. */
  minutes?: number;
}

/**
 * A branch's latest PR run from `gh run list --json databaseId,status,startedAt,url`, with its PR's
 * conflict and failed checks from `gh pr view --json mergeable,statusCheckRollup`: "none" when
 * the list is empty, null when the list is missing or does not read (#741: GitHub unread); a PR
 * unread leaves the run's age to decide (#945 review).
 */
export function prRunFrom(runs: string | null, pr: string | null, now: number): PrRunAnswer {
  try {
    const list = JSON.parse(runs ?? "") as Array<Record<string, unknown>>;
    if (Array.isArray(list) && list.length === 0) return "none";
    const latest = list[0];
    if (!latest || typeof latest.databaseId !== "number") return null;
    const started = Date.parse(String(latest.startedAt));
    if (Number.isNaN(started)) return null;
    const view = parsedView(pr);
    return {
      id: latest.databaseId,
      url: typeof latest.url === "string" ? latest.url : "",
      inProgress: latest.status !== "completed",
      failed: (view.statusCheckRollup ?? []).some((check) =>
        FAILED_CHECK.has(check.conclusion ?? check.state ?? ""),
      ),
      conflicting: view.mergeable === "CONFLICTING",
      minutes: Math.floor((now - started) / 60_000),
      // Only a PR read with the field and none set: an unread PR is not known to be off.
      // A merged or closed PR's null says nothing (#1560 review): only an open one counts.
      ...(view.state === "OPEN" && "autoMergeRequest" in view && view.autoMergeRequest === null
        ? { autoMergeOff: true }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The PR's mergeable state and checks, or none known when `gh pr view` failed or printed no JSON:
 * the run's age decides then (#945 review), so a PR unread alone never holds a push.
 */
function parsedView(text: string | null): {
  mergeable?: string;
  autoMergeRequest?: unknown;
  state?: string;
  statusCheckRollup?: Array<{ conclusion?: string; state?: string }>;
} {
  try {
    return JSON.parse(text ?? "") ?? {};
  } catch {
    return {};
  }
}

/** Runs gh with these arguments in a folder; its output, or null when it fails. */
export type Gh = (args: string[], dir: string) => string | null;

/**
 * The guard's reader of a branch's latest PR run (#756 review: the gh calls are tested here, not
 * left as glue): `gh run list`, then `gh pr view` only when there is a run.
 */
export function prRunVia(gh: Gh, now: () => number): (branch: string, dir: string) => PrRunAnswer {
  return (branch, dir) => {
    // The branch goes as one `--branch=` word, so no name reads as a flag.
    const runs = gh(
      [
        "run",
        "list",
        `--branch=${branch}`,
        "--event=pull_request",
        "--limit=1",
        "--json=databaseId,status,startedAt,url",
      ],
      dir,
    );
    if (runs === null) return null;
    if (runs.trim() === "[]") return "none";
    // `--` ends the flags, so the branch is always the PR to view.
    const pr = gh(
      ["pr", "view", "--json=mergeable,statusCheckRollup,autoMergeRequest,state", "--", branch],
      dir,
    );
    return prRunFrom(runs, pr, now());
  };
}

/** The check conclusions (a check run's) and states (a commit status's) that mean it failed. */
const FAILED_CHECK = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
  "ERROR",
]);

/** How young a green PR run must be for a push to wait for it (#741). */
const PUSH_WAIT_MINUTES = 20;

/**
 * Why a push would cancel a PR run that is still green (#741), or null. A new push cancels the
 * branch's run in progress (`cancel-in-progress`); 10% of the PR runner-minutes went to runs a push
 * cancelled while still green. A PR with a failed check or a conflict (the push is a fix), an
 * ended or older run, no run, a release-v* branch, the coordinator and
 * `FLIGHTDECK_PUSH_NOW="<reason>"` in front of the push pass. When GitHub cannot be read, twice,
 * the push holds too, with the same override line: a silent pass let green runs be cancelled.
 */
export function pushWaitViolation(command: string, cwd: string, deps: PushWaitDeps): string | null {
  return pushWaitCheck(command, cwd, deps).violation;
}

/**
 * The push-wait decision of a command (#741): the refusal, or, for each pushed branch the rule
 * looked at and let go, why. A delete, a release-v* branch, an override and the coordinator are
 * not looked at, so they log no pass.
 */
export function pushWaitCheck(
  command: string,
  cwd: string,
  deps: PushWaitDeps,
): { violation: string | null; passes: PushWaitPass[] } {
  const passes: PushWaitPass[] = [];
  if (deps.env.FLIGHTDECK_COORDINATOR) return { violation: null, passes };
  for (const call of gitCalls(command, cwd)) {
    const push = pushToCheck(call, command, deps);
    if (push === null) continue;
    const { dir, override } = push;
    for (const branch of pushedBranches(call, (args) => deps.git(args, dir))) {
      const verdict = branchVerdict(branch, dir, override, deps);
      if ("violation" in verdict) return { violation: verdict.violation, passes };
      passes.push(verdict.pass);
    }
  }
  return { violation: null, passes };
}

/**
 * The folder and the override line of a push the rule looks at (#741), or null for any other git
 * call, a push outside the project and a push that carries `FLIGHTDECK_PUSH_NOW="<reason>"`.
 */
function pushToCheck(
  call: GitCall,
  command: string,
  deps: PushWaitDeps,
): { dir: string; override: string } | null {
  if (call.sub !== "push" || call.dir === null) return null;
  if (deps.inProject && !deps.inProject(call.dir)) return null;
  const segment = command.slice(call.start, call.end);
  if (heavyReasonGiven(prefixAssignment(segment, "FLIGHTDECK_PUSH_NOW"))) return null;
  // Unprintable characters out first, so none reaches the terminal or splits a secret (#945 review).
  const override = `FLIGHTDECK_PUSH_NOW="<reason>" ${redacted(printable(segment.trim()))}`;
  return { dir: call.dir, override };
}

/** Whether one pushed branch holds the push (the refusal) or goes (why), #741. */
function branchVerdict(
  branch: string,
  dir: string,
  override: string,
  deps: PushWaitDeps,
): { violation: string } | { pass: PushWaitPass } {
  // The name comes from the command or from git: unprintable characters out first (so none splits a secret), then secrets hidden (#945 review).
  const shown = redacted(printable(branch));
  // A reason an earlier branch's lookups left is not this branch's (#945 security review).
  deps.whyUnread?.();
  // One more try: a gh call can time out once on a busy machine.
  const run = deps.prRun(branch, dir) ?? deps.prRun(branch, dir);
  if (run === null) {
    // No lookup could answer (gh missing, no time left): retrying would not help, so it goes,
    // logged with why (#945 review). GitHub that answered with a failure holds.
    const why = deps.whyUnread?.() ?? null;
    if (why) return { pass: { reason: why } };
    return {
      violation: `GitHub could not be read to check the PR run of ${shown}, twice (#741). Push again in a minute, or push now with:\n  ${override}`,
    };
  }
  if (run === "none") return { pass: { reason: "no run" } };
  const pass = pushWaitPass(run);
  if (pass) return { pass };
  // Only GitHub's own https address; the echoed push hides credentials (security review).
  const url = /^https:\/\/[!-~]+$/.test(run.url) ? `: ${run.url}` : "";
  return {
    violation: `a push now cancels CI run ${run.id} on the PR of ${shown}, ${run.minutes} min old with no failed check (#741)${url}. Batch the next commits with this one and push once the run ends, or push now with:\n  ${override}`,
  };
}

/**
 * Why a push may go past this run, or null when it would cancel it while young and green; `pr
 * update` asks it too (#741).
 */
export function pushWaitPass(run: PrRun): PushWaitPass | null {
  // A failed check or a conflict makes the push a fix that must go out (#756 review).
  if (run.failed) return { reason: "failed check" };
  if (run.conflicting) return { reason: "conflicts" };
  // #1541: with auto-merge off the run merges nothing; every such block of a day was overridden.
  if (run.autoMergeOff) return { reason: "auto-merge off" };
  if (!run.inProgress) return { reason: "run ended" };
  if (run.minutes >= PUSH_WAIT_MINUTES) return { reason: "old run", minutes: run.minutes };
  return null;
}

/**
 * The branches a push updates (#756 review): each refspec's destination, or HEAD's branch for a
 * bare push. None for a delete; a tag and a release-v* branch never wait.
 */
function pushedBranches(call: GitCall, git: (args: string[]) => string | null): string[] {
  const words = readPushWords(call.args.map((a) => a.word));
  if (words.deleting) return [];
  const current = git(["symbolic-ref", "--short", "HEAD"])?.trim() || null;
  const refspecs = words.positional.slice(1);
  const targets: PushTarget[] =
    refspecs.length === 0
      ? [{ dst: current, tag: false, plus: false }]
      : refspecs.map((spec) => pushTarget(spec, false, current, git));
  return targets.flatMap(({ dst, tag }) =>
    dst && !tag && !dst.startsWith("release-v") ? [dst] : [],
  );
}

/** The guard's gh for push-wait (#945 review): calls start only before `limit`; why nothing answered. */
export function budgetedGh(
  spawn: (args: string[], dir: string) => { stdout: string | null; missing: boolean },
  exists: (dir: string) => boolean,
  now: () => number,
  limit: number,
): { gh: Gh; whyUnread: () => string | null } {
  let why: string | null = null;
  return {
    gh: (args, dir) => {
      if (now() > limit) {
        why ??= "no time";
        return null;
      }
      const ran = spawn(args, dir);
      // spawn says ENOENT for a folder that does not exist too: only an existing one means gh is
      // missing (#945 security review: `cd nowhere; git push` must not pass).
      if (ran.missing && exists(dir)) why ??= "gh missing";
      return ran.stdout;
    },
    // Read once: the next branch's lookups start with no reason left over (#945 security review).
    whyUnread: () => {
      const said = why;
      why = null;
      return said;
    },
  };
}

/**
 * `fn`, made only while `now()` is at or before `limit` (#826 review); past it, null with no call.
 * The guard wraps its gh and git calls so each starts early enough to end inside the hook's 10 s.
 */
export function withBudget<A extends unknown[], R>(
  fn: (...args: A) => R | null,
  now: () => number,
  limit: number,
): (...args: A) => R | null {
  return (...args) => (now() > limit ? null : fn(...args));
}

/**
 * A push that goes ahead on a FLIGHTDECK_PUSH_NOW override (#741), or null: its reason, with
 * secrets hidden and cut at 200 characters, and, given the push's folder and deps, the age of the
 * pushed branch's PR run (#741: logged so the overrides can be read). The log counts every such
 * push, also one the rule would have let through: harness:stats shows an upper bound.
 */
function pushNowOverride(
  command: string,
  push?: { cwd: string; deps: PushWaitDeps },
): { detail: string; minutes?: number } | null {
  for (const call of gitCalls(command, push?.cwd ?? "/")) {
    if (call.sub !== "push") continue;
    const reason = prefixAssignment(command.slice(call.start, call.end), "FLIGHTDECK_PUSH_NOW");
    if (!heavyReasonGiven(reason)) continue;
    const dir = call.dir;
    // A checkout outside the project is not the rule's: no waiver, and gh is not asked there. A
    // folder the parse cannot tell (dir null) still logs the reason alone: an upper bound.
    if (dir !== null && push?.deps.inProject && !push.deps.inProject(dir)) continue;
    // Unprintable characters go first, so none reaches the terminal and none splits a secret.
    // Cut before the redaction too, so its regexes never scan an unbounded reason; the last cut
    // counts characters, never splitting one in two.
    const detail = Array.from(
      redacted(
        printable(reason ?? "")
          .trim()
          .slice(0, 2000),
      ),
    )
      .slice(0, 200)
      .join("");
    if (!push || dir === null) return { detail };
    const ages = pushedBranches(call, (args) => push.deps.git(args, dir)).flatMap((branch) => {
      const run = push.deps.prRun(branch, dir);
      return run && run !== "none" && run.inProgress ? [run.minutes] : [];
    });
    return ages.length > 0 ? { detail, minutes: Math.min(...ages) } : { detail };
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
