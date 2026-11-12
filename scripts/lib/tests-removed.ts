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
/** A test: `test(`, `it(`, a modifier that takes the test next (`.skipIf(`, `.if(`), or `.each` with a table. */
const TEST =
  /(?<![\w$.])(?:test|it)(?:\.(?:skipIf|if|only|skip|todo|failing|serial|concurrent))?\(|(?<![\w$.])(?:test|it)\.each[(`]/g;
const EXPECT = /(?<![\w$.])expect\(/g;
/** `Tests-Removed: <paths> — <why>`, the key in any case as git reads trailers. */
const TRAILER = /^tests-removed:[^\S\n]*(.*)$/gim;
/** The dash that ends the paths: the first em or en dash, else the first hyphen with a space on each side. */
const DASHES = [/[^\S\n]*[—–][^\S\n]*/, /[^\S\n]+--?[^\S\n]+/];

/** A test file's tests and `expect(` calls. */
export function countTests(text: string): TestCount {
  return { tests: text.match(TEST)?.length ?? 0, expects: text.match(EXPECT)?.length ?? 0 };
}

/** The reason each file named by a `Tests-Removed:` trailer was waived for, by its path. */
function waivers(messages: string[]): Map<string, string> {
  const named = new Map<string, string>();
  for (const message of messages)
    for (const [, value = ""] of message.matchAll(TRAILER)) {
      const dash = DASHES.map((pattern) => pattern.exec(value)).find((found) => found);
      if (!dash) continue;
      const why = value.slice(dash.index + dash[0].length).trim();
      if (why === "") continue;
      for (const part of value.slice(0, dash.index).split(",")) {
        const path = part.trim().replace(/^`(.*)`$/, "$1");
        if (path !== "" && !named.has(path)) named.set(path, why);
      }
    }
  return named;
}

function counted(count: TestCount): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${plural(count.tests, "test")}, ${plural(count.expects, "expect")}`;
}

/** What a changed test file holds at the head: its count, or why it has none. */
function atHead(change: FileChange, text: string | null): TestCount | string {
  if (change.status === "D") return "deleted";
  if (!TEST_FILE.test(change.path)) return "not a test file at the head";
  return text === null ? "unread" : countTests(text);
}

export function removalVerdict(input: RemovalInput): RemovalVerdict {
  const named = waivers(input.messages);
  const problems: string[] = [];
  const waived: string[] = [];
  for (const change of input.changes) {
    if (change.status === "A") continue;
    const from = change.from ?? change.path;
    if (!TEST_FILE.test(from)) continue;
    const name = change.from ? `${change.path} (was ${from})` : change.path;
    const base = input.before(from);
    const is = atHead(change, change.status === "D" ? null : input.after(change.path));
    // A text git could not read is never taken as empty: the check fails closed.
    if (base === null || is === "unread") {
      problems.push(`${name}: git could not read it at the ${base === null ? "base" : "head"}`);
      continue;
    }
    const was = countTests(base);
    if (typeof is !== "string" && is.tests >= was.tests && is.expects >= was.expects) continue;
    const line = `${name}: ${counted(was)} at the base; ${typeof is === "string" ? is : `${counted(is)} at the head`}`;
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
  if (!base)
    return {
      code: 1,
      output: "tests-removed: no merge-base with main, so nothing was checked; fetch main",
    };
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
