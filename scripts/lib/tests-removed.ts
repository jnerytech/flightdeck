/**
 * Issue #2176: the removed-tests guard. A PR whose net diff (from the merge-base with main to
 * HEAD) leaves a test file with fewer tests or fewer `expect(` calls than at the base, or deletes
 * one, fails unless a commit in the range carries `Tests-Removed: <path>[, <path>] — <why>` naming
 * that file. The net diff judges a merge of main by its result: a conflict resolution that drops
 * tests is caught even when the branch's own commits never touched the file.
 */
import { type FileChange, parseChanges } from "./structure-guard.ts";

/** A test file's tests (`test(`, `it(`, `.each`, `.skipIf`) and `expect(` calls. */
export interface TestCount {
  tests: number;
  expects: number;
}

export interface RemovalInput {
  changes: FileChange[];
  /** The full messages of the PR's commits, merges included. */
  messages: string[];
  before: (path: string) => string | null;
  after: (path: string) => string | null;
}

export interface RemovalVerdict {
  /** One line per file that lost tests or expects with no trailer naming it. */
  problems: string[];
  /** One line per file that lost tests or expects, waived by a trailer, with its reason. */
  waived: string[];
}

const TEST_FILE = /\.test\.tsx?$/;
/** A test: `test(`, `it(`, or one of their modifiers that takes the test next (`.each`, `.skipIf`, `.if`). */
const TEST =
  /(?<![\w$.])(?:test|it)(?:\.(?:each|skipIf|if|only|skip|todo|failing|serial|concurrent))?\s*[(`]/g;
const EXPECT = /(?<![\w$.])expect\s*\(/g;
/** `Tests-Removed: <path>[, <path>] — <why>`: a dash with a space on each side ends the paths. */
const TRAILER = /^Tests-Removed:[ \t]*(\S.*?)[ \t]+(?:—|–|--?)[ \t]+(\S.*)$/gm;

/** A test file's tests and `expect(` calls. */
export function countTests(text: string): TestCount {
  return { tests: text.match(TEST)?.length ?? 0, expects: text.match(EXPECT)?.length ?? 0 };
}

/** The reason each file named by a `Tests-Removed:` trailer was waived for, by its path. */
function waivers(messages: string[]): Map<string, string> {
  const named = new Map<string, string>();
  for (const message of messages)
    for (const [, paths = "", why = ""] of message.matchAll(TRAILER))
      for (const path of paths.split(",").map((part) => part.trim()))
        if (!named.has(path)) named.set(path, why.trim());
  return named;
}

function counted(count: TestCount): string {
  return `${count.tests} tests, ${count.expects} expects`;
}

export function removalVerdict(input: RemovalInput): RemovalVerdict {
  const named = waivers(input.messages);
  const problems: string[] = [];
  const waived: string[] = [];
  for (const change of input.changes) {
    if (change.status === "A") continue;
    const from = change.from ?? change.path;
    if (!TEST_FILE.test(from)) continue;
    const was = countTests(input.before(from) ?? "");
    const text = change.status === "D" ? null : input.after(change.path);
    const is = text === null ? null : countTests(text);
    if (is && is.tests >= was.tests && is.expects >= was.expects) continue;
    const name = change.from ? `${change.path} (was ${from})` : change.path;
    const line = `${name}: ${counted(was)} at the base; ${is ? `${counted(is)} at the head` : "deleted"}`;
    const why = named.get(from);
    if (why === undefined) problems.push(line);
    else waived.push(`${line} (waived: ${why})`);
  }
  return { problems, waived };
}

/** The guard over git: the net diff from the merge-base with main to HEAD. */
export function runTestsRemoved(deps: { git: (args: string[]) => string | null }): {
  code: number;
  output: string;
} {
  const { git } = deps;
  const base = ["origin/main", "main"]
    .map((main) => git(["merge-base", "HEAD", main])?.trim())
    .find((found) => found);
  if (!base) return { code: 0, output: "tests-removed: no merge-base with main; nothing to check" };
  const verdict = removalVerdict({
    changes: parseChanges(git(["diff", "--name-status", "-M", `${base}..HEAD`]) ?? ""),
    messages: (git(["log", "--format=%B%x00", `${base}..HEAD`]) ?? "").split("\0"),
    before: (path) => git(["show", `${base}:${path}`]),
    after: (path) => git(["show", `HEAD:${path}`]),
  });
  const waived = verdict.waived.map((line) => `  - ${line}`);
  if (verdict.problems.length === 0)
    return {
      code: 0,
      output:
        waived.length === 0
          ? "tests-removed: no test file lost tests or expects"
          : [
              "tests-removed: no test file lost tests or expects but the waived ones:",
              ...waived,
            ].join("\n"),
    };
  return {
    code: 1,
    output: [
      "tests-removed: a test file lost tests or expects, and no commit's Tests-Removed: trailer names it:",
      ...verdict.problems.map((problem) => `  - ${problem}`),
      ...(waived.length > 0 ? ["Waived:", ...waived] : []),
      "A merge of main may have dropped them (#2154): restore them from the base. If the removal is",
      "meant, add a commit whose message ends with `Tests-Removed: <path>[, <path>] — <why>`, naming",
      "each file by its path at the base (docs/TDD.md, #2176).",
    ].join("\n"),
  };
}
