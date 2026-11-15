/**
 * The rules behind the project's Claude Code hooks (.claude/hooks), kept here to be tested.
 * The hooks only read the tool call from stdin and apply these.
 */
import { existsSync, lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { FORBIDDEN_MARKERS, uncommentedOffLinux } from "../guards/tdd-audit.ts";
import { assertionCounts, weakensAssertions } from "../guards/weak-assert.ts";
import { commitWaived } from "./commit-rules.ts";
import { heavyRunWaived } from "./heavy-run-rules.ts";
import type { PushWaitDeps, PushWaitPass } from "./push-wait.ts";
import { pushNowOverride } from "./push-wait.ts";
import { gitCalls } from "./shell-parse.ts";

export { commitViolation, commitWaived } from "./commit-rules.ts";
export { heavyRunViolation, heavyRunWaived, slotViolation } from "./heavy-run-rules.ts";
export { prMergeViolation, pushViolation } from "./push-rules.ts";
export type { PrRun, PushWaitDeps, PushWaitPass } from "./push-wait.ts";
export {
  budgetedGh,
  prRunFrom,
  prRunVia,
  pushWaitCheck,
  pushWaitPass,
  pushWaitViolation,
  withBudget,
} from "./push-wait.ts";
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
