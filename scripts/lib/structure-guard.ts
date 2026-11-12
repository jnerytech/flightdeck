/**
 * Issue #1602: the structure-only PR guard. A PR whose commits are all `refactor(...)`, or that
 * carries the `structure` label, is a move: it may move, rename and re-import code, never change
 * what a test checks or what a dictionary says. A test that needs more than an import path in a
 * move is coupled to an implementation detail (Khorikov, #1604): the guard names it.
 */

/** One changed file of the PR, as `git diff --name-status -M` gives it. */
export interface FileChange {
  status: "A" | "D" | "M" | "R";
  path: string;
  /** The old path of a rename. */
  from?: string;
}

export interface StructureInput {
  /** The subjects of the PR's own commits, merges left out. */
  commits: string[];
  labels: string[];
  changes: FileChange[];
  /** A file's text at the base, or null when it did not exist. */
  before: (path: string) => string | null;
  /** A file's text at the head, or null when it does not exist. */
  after: (path: string) => string | null;
}

export interface StructureVerdict {
  /** Whether the PR is a structure-only move, so the rules applied. */
  structural: boolean;
  /** One line per file that broke a rule: `<path>: <why>`. */
  problems: string[];
}

const TEST_FILE = /\.test\.tsx?$/;
const DICTIONARY = /^apps\/desktop\/src\/i18n\//;
const REFACTOR = /^refactor(\([^)]*\))?!?: /;
/** An import or re-export statement, multi-line included. */
const IMPORT_FROM =
  /^[ \t]*(?:import(?=[\s{*])|export\s*(?:\*|\{))[^;]*?\bfrom\s*["'][^"']*["'];?/gm;
/** A side-effect import. */
const IMPORT_BARE = /^[ \t]*import\s*["'][^"']*["'];?/gm;

/** A source text with its import and re-export statements left out. */
function withoutImports(text: string): string {
  return text.replace(IMPORT_FROM, "").replace(IMPORT_BARE, "");
}
/** A string that names a module or file by a relative path or the workspace package. */
const PATH = /(["'])(?:\.{1,2}\/|@flightdeck\/)[^"'\n]*\1/g;
const STRING = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

/** A test's text with its imports and path strings left out: what a move may not change. */
function body(text: string): string {
  return withoutImports(text)
    .replace(PATH, '"<path>"')
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/** A name's camelCase words, lower case: `checkClientBudgets` is check, client, budgets. */
function words(name: string): string[] {
  return name
    .split(/(?=[A-Z])|_/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

/** Whether every item of `part` is in `whole`, counting repeats. */
function within(part: string[], whole: string[]): boolean {
  return minus(part, whole).length === 0;
}

/** A comment, a string or template literal, a word, `++`/`--`, or one sign, from the start of the text. */
const LEXEME =
  /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\w+|\+\+|--|[^\w\s])/;
/** A regex literal, from the start of the text. */
const REGEX = /^\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/\w*/;
const WORD = /^\w+$/;
/** The words after which a `/` divides; after anything else it starts a regex. */
const DIVIDES = /^(?:\w+|\)|\])$/;
const KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "void", "yield"]);
/** The words a line break after ends the statement (automatic semicolon insertion). */
const RESTRICTED = new Set(["return", "throw", "break", "continue", "yield"]);
const OPENING = new Set([",", "[", "(", "{"]);

/**
 * A body's tokens. The whitespace between them is the formatter's, but a literal (a string, a
 * template, a regex) or a comment stays one token, a line break after `return` stays, and a
 * trailing comma before a closing bracket is dropped (the formatter adds it on a wrap) unless it
 * makes an array hole.
 */
function tokens(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest !== "") {
    const space = /^\s+/.exec(rest)?.[0] ?? "";
    if (space !== "") {
      const last = out.at(-1) ?? "";
      if (space.includes("\n") && RESTRICTED.has(last)) out.push("\n");
      rest = rest.slice(space.length);
      continue;
    }
    const last = out.at(-1) ?? "";
    const regex =
      rest.startsWith("/") && (!DIVIDES.test(last) || KEYWORDS.has(last)) ? REGEX.exec(rest) : null;
    const token = regex?.[0] ?? LEXEME.exec(rest)?.[0] ?? rest.charAt(0);
    out.push(token);
    rest = rest.slice(token.length);
  }
  return out.filter(
    (token, k) =>
      token !== "," || !/^[)\]}]$/.test(out[k + 1] ?? "") || OPENING.has(out[k - 1] ?? ""),
  );
}

/** Whether the tokens before index `i` read `store.` or `store.getState().`, the app's store in a test. */
function onStore(a: string[], i: number): boolean {
  if (a[i - 1] !== ".") return false;
  if (a[i - 2] === "store") return a[i - 3] !== ".";
  const read = a.slice(i - 6, i - 1).join(" ");
  return read === "store . getState ( )" && a[i - 7] !== ".";
}

/**
 * Whether a store method moved under a slice: the same method under any slice (`refresh` became
 * `board.refresh`), or the old name split into the slice and the method (`checkClientBudgets` became
 * `clientBudgets.check`, `addCard` became `cards.add`). Only a call: a field read under a new slice may read nothing.
 */
function sliceOf(member: string, slice: string, called: string, next: string): boolean {
  if (next !== "(" || ![member, slice, called].every((token) => WORD.test(token))) return false;
  if (called === member) return true;
  const rest = minus(words(member), words(called));
  if (!within(words(called), words(member))) return false;
  // The slice may name the member's words in the plural (`addCard` became `cards.add`), never the reverse.
  const slices = words(slice).map((word) =>
    rest.find((part) => part === word || `${part}s` === word),
  );
  return (
    slices.length === rest.length &&
    slices.every((part) => part !== undefined) &&
    within(
      slices.filter((part) => part !== undefined),
      rest,
    )
  );
}

/**
 * Issue #1732: whether a moved test checks the same: its tokens are equal but for store members
 * moved under a slice (`store.x` became `store.slice.x`). Strings stay whole tokens, so a text
 * inside one never counts as a move.
 */
function sameBody(was: string, is: string): boolean {
  if (was === is) return true;
  const a = tokens(was);
  const b = tokens(is);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const moved =
      onStore(a, i) &&
      b[j + 1] === "." &&
      sliceOf(a[i] ?? "", b[j] ?? "", b[j + 2] ?? "", b[j + 3] ?? "");
    if (!moved) return false;
    i++;
    j += 3;
  }
  return i === a.length && j === b.length;
}

/** The texts of a dictionary file, imports left out. */
function texts(text: string | null): string[] {
  if (text === null) return [];
  return [...withoutImports(text).matchAll(STRING)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** The items of `a` that `b` does not have, counting repeats. */
function minus(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const item of b) left.set(item, (left.get(item) ?? 0) + 1);
  return a.filter((item) => {
    const n = left.get(item) ?? 0;
    if (n > 0) left.set(item, n - 1);
    return n === 0;
  });
}

/** Whether every commit is a refactor, or the PR carries the `structure` label. */
function isStructural(commits: string[], labels: string[]): boolean {
  return (
    labels.includes("structure") || (commits.length > 0 && commits.every((c) => REFACTOR.test(c)))
  );
}

export function structureVerdict(input: StructureInput): StructureVerdict {
  const { commits, labels, changes, before, after } = input;
  if (!isStructural(commits, labels)) return { structural: false, problems: [] };
  const problems: string[] = [];
  const was: string[] = [];
  const is: string[] = [];
  for (const change of changes) {
    const from = change.status === "R" ? (change.from ?? change.path) : change.path;
    const oldText = change.status === "A" ? null : before(from);
    const newText = change.status === "D" ? null : after(change.path);
    if (DICTIONARY.test(from) || DICTIONARY.test(change.path)) {
      if (DICTIONARY.test(from)) was.push(...texts(oldText));
      if (DICTIONARY.test(change.path)) is.push(...texts(newText));
      continue;
    }
    const wasTest = oldText !== null && TEST_FILE.test(from);
    const isTest = newText !== null && TEST_FILE.test(change.path);
    if (isTest && !wasTest) problems.push(`${change.path}: a test added`);
    else if (wasTest && !isTest) problems.push(`${from}: a test deleted`);
    else if (wasTest && isTest && !sameBody(body(oldText), body(newText)))
      problems.push(`${change.path}: changed beyond its import paths`);
  }
  const changed = [...minus(was, is), ...minus(is, was)];
  if (changed.length > 0) {
    const shown = changed.slice(0, 5).join(", ") + (changed.length > 5 ? ", ..." : "");
    problems.push(`apps/desktop/src/i18n: a dictionary text changed (${shown})`);
  }
  return { structural: true, problems };
}

/** `git diff --name-status -M` lines as changes; a copy counts as an added file. */
function parseChanges(text: string): FileChange[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [code = "", first = "", second = ""] = line.split("\t");
      if (code.startsWith("R")) return { status: "R" as const, path: second, from: first };
      if (code.startsWith("C")) return { status: "A" as const, path: second };
      const status: FileChange["status"] =
        code.startsWith("A") || code.startsWith("D") ? (code[0] as "A" | "D") : "M";
      return { status, path: first };
    });
}

/** The guard over git: the PR's range from the merge-base with main to HEAD. */
export function runStructureGuard(deps: {
  git: (args: string[]) => string | null;
  labels: string[];
}): { code: number; output: string } {
  const { git, labels } = deps;
  const base = ["origin/main", "main"]
    .map((main) => git(["merge-base", "HEAD", main])?.trim())
    .find((found) => found);
  if (!base)
    return { code: 0, output: "structure-guard: no merge-base with main; nothing to check" };
  const commits = (git(["log", "--no-merges", "--format=%s", `${base}..HEAD`]) ?? "")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const verdict = structureVerdict({
    commits,
    labels,
    changes: parseChanges(git(["diff", "--name-status", "-M", `${base}..HEAD`]) ?? ""),
    before: (path) => git(["show", `${base}:${path}`]),
    after: (path) => git(["show", `HEAD:${path}`]),
  });
  if (!verdict.structural) {
    const n = commits.filter((c) => !REFACTOR.test(c)).length;
    const what = n === 1 ? "1 commit is" : `${n} commits are`;
    return { code: 0, output: `structure-guard: not a structure-only PR (${what} not a refactor)` };
  }
  if (verdict.problems.length === 0)
    return {
      code: 0,
      output: "structure-guard: a structure-only PR; no test or dictionary text changed",
    };
  return {
    code: 1,
    output: [
      "structure-guard: a structure-only PR (every commit a refactor, or the structure label) changed what a move must leave alone:",
      ...verdict.problems.map((problem) => `  - ${problem}`),
      "A test that needs more than an import path in a move is coupled to an implementation detail",
      "(docs/TDD.md, Khorikov, #1604): keep the move, put the test change in a PR of its own, and open",
      "an issue to make the test check behavior. A dictionary text change goes in a PR of its own too.",
    ].join("\n"),
  };
}
