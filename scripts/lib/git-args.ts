import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** One `git(...)` call that gives a branch or revision to git with nothing between it and an option. */
export interface GitArgFinding {
  file: string;
  line: number;
  call: string;
}

/** A call of the daemon's git helpers: `git(`, `gitLimited(`, `this.git(`, `deps.git(`. */
const CALL = /(?<![\w$])(?:[\w$]+\.)*(?:git|gitLimited)\(/g;
/** A name that carries a branch or a revision in, from a project's settings or a protocol field. */
const REF_TOKEN =
  /^(?:(?:base|branch|source|ref|against|upstream)\w*|rev(?:ision)?(?:[A-Z_]\w*)?|(?:start|target)[A-Z]\w*|\w*[a-z](?:Base|Branch|Source|Rev|Ref|Against|Upstream)\w*)$/;
/** Other calls that start a program from an array: git is the one that follows `"git"` in it. */
const SPAWN = /(?<![\w$])(?:[\w$]+\.)*(?:spawn|spawnSync|runCommand|exec)\(/g;
const REVIEWED = /\/\/ git-arg: \S/;

/**
 * The source with comments blanked, the text of strings and templates turned into `_`, and
 * everything else (the quotes, `${`, `}` and the code inside a template) kept: same length, so
 * offsets and lines hold.
 */
function mask(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const underscore = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = "_";
  };
  /** From the char after an opening backtick; returns the index after the closing one. */
  const template = (start: number): number => {
    let i = start;
    let from = start;
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") i += 2;
      else if (source[i] === "$" && source[i + 1] === "{") {
        underscore(from, i);
        i = code(i + 2, true);
        from = i;
      } else i++;
    }
    underscore(from, i);
    return i + 1;
  };
  /** Blanks the `//` comment at `i`; returns the index of the end of the line. */
  const lineComment = (i: number): number => {
    const end = source.indexOf("\n", i);
    const to = end === -1 ? source.length : end;
    blank(i, to);
    return to;
  };
  /** Blanks the block comment at `i`; returns the index after its end. */
  const blockComment = (i: number): number => {
    const end = source.indexOf("*/", i + 2);
    const to = end === -1 ? source.length : end + 2;
    blank(i, to);
    return to;
  };
  /** Turns the text of the string opened by `quote` at `i` into `_`; returns the index after it. */
  const quoted = (i: number, quote: string): number => {
    let j = i + 1;
    while (j < source.length && source[j] !== quote && source[j] !== "\n")
      j += source[j] === "\\" ? 2 : 1;
    underscore(i + 1, j);
    return j + 1;
  };
  /** Masks the comment, string or template that starts at `i`; returns the index after it, or null when none does. */
  const skipped = (i: number): number | null => {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") return lineComment(i);
    if (c === "/" && next === "*") return blockComment(i);
    if (c === '"' || c === "'") return quoted(i, c);
    if (c === "`") return template(i + 1);
    return null;
  };
  /** Masks code from `i`; with `inBraces` it stops after the `}` that closes the `${`. */
  const code = (start: number, inBraces: boolean): number => {
    let i = start;
    let depth = 0;
    while (i < source.length) {
      const to = skipped(i);
      if (to !== null) {
        i = to;
        continue;
      }
      const c = source[i];
      if (c === "}" && inBraces && depth === 0) return i + 1;
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    return i;
  };
  code(0, false);
  return out.join("");
}

/** The index of the parenthesis that closes the one at `open`, in masked text; -1 when there is none. */
function closing(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    if (masked[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Top-level `[from, to)` spans of the comma-separated items between two offsets of masked text. */
function split(masked: string, from: number, to: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const c = masked[i] as string;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, to]);
  return spans;
}

/** The text of a masked argument with every `refArg(...)` taken out: what is left is unguarded. */
function withoutGuards(text: string): string {
  let out = text;
  for (let at = out.indexOf("refArg("); at !== -1; at = out.indexOf("refArg(")) {
    const end = closing(out, at + "refArg".length);
    out = `${out.slice(0, at)} ${end === -1 ? "" : out.slice(end + 1)}`;
  }
  return out;
}

/** The code inside the first `${...}` of a masked template that starts with one. */
function firstInterpolation(text: string): string {
  let depth = 0;
  let end = 3;
  while (end < text.length && !(text[end] === "}" && depth === 0)) {
    if (text[end] === "{") depth++;
    if (text[end] === "}") depth--;
    end++;
  }
  return text.slice(3, end);
}

/** Whether one masked argument starts with, or is built from, a name that carries a branch in. */
function exposed(argument: string): boolean {
  const text = argument.trim();
  if (text === "") return false;
  if (text.startsWith('"') || text.startsWith("'")) return false;
  if (text.startsWith("`")) {
    // Text before the first `${` makes it a prefix (`refs/heads/...`): only a template that starts
    // with the interpolation is exposed.
    if (!text.startsWith("`${")) return false;
    return exposed(firstInterpolation(text));
  }
  if (text.startsWith("...")) {
    const spread = text.slice(3).trim();
    // A constant list is fine; a plain name could hold anything, and an expression is read.
    if (/^[A-Za-z_$][\w$]*$/.test(spread)) return !/^[A-Z][A-Z0-9_]*$/.test(spread);
    return exposed(spread);
  }
  return (withoutGuards(text).match(/[A-Za-z_$][\w$]*/g) ?? []).some((token) =>
    REF_TOKEN.test(token),
  );
}

/** Calls of `git(` and `gitLimited(` in `source` that pass a base or branch without a guard (issue #345). */
export function unguardedGitCalls(source: string, file = ""): GitArgFinding[] {
  const masked = mask(source);
  const lines = source.split("\n");
  const found: GitArgFinding[] = [];
  const isEnd = (from: number, to: number) =>
    ["'--end-of-options'", '"--end-of-options"', "'--'", '"--"'].includes(
      source.slice(from, to).trim(),
    );
  /** An array of arguments is read item by item, at the same level as the arguments around it. */
  const flat = (open: number, close: number) =>
    split(masked, open + 1, close).flatMap(([from, to]): Array<[number, number]> => {
      const text = masked.slice(from, to).trim();
      if (!text.startsWith("[") || !text.endsWith("]")) return [[from, to]];
      const inner = from + masked.slice(from, to).indexOf("[") + 1;
      return split(masked, inner, from + masked.slice(from, to).lastIndexOf("]"));
    });
  const check = (open: number, kind: "git" | "spawn") => {
    const line = source.slice(0, open).split("\n").length;
    const close = closing(masked, open);
    if (close === -1) throw new Error(`${file}:${line}: cannot read the arguments of this call`);
    // `git(cwd, ...args) {` or `git(cwd): Promise<X> {` declares the helper: it is not a call.
    if (/^\s*(?::[^;={}]+)?\{/.test(masked.slice(close + 1))) return;
    let spans = flat(open, close);
    if (kind === "spawn") {
      // Only a program started with `"git"` first in its array: what follows it goes to git.
      const first = split(masked, open + 1, close)[0] as [number, number];
      const items = flat(first[0] - 1, first[1]);
      const at = items.findIndex(([from, to]) =>
        /^(?:["']git["']|[\w$.]*whichOnPath\(["']git["']\)[^,]*)$/.test(
          source.slice(from, to).trim(),
        ),
      );
      if (at === -1 || !masked.slice(first[0], first[1]).trim().startsWith("[")) return;
      spans = items.slice(at + 1);
    }
    const ended = spans.findIndex(([from, to]) => isEnd(from, to));
    const read = ended === -1 ? spans : spans.slice(0, ended);
    if (!read.some(([from, to]) => exposed(masked.slice(from, to)))) return;
    const lastLine = line + source.slice(open, close).split("\n").length - 1;
    const reviewed = [lines[line - 2], lines[line - 1], lines[lastLine - 1]].some((l) =>
      REVIEWED.test(l ?? ""),
    );
    if (reviewed) return;
    found.push({
      file,
      line,
      call: source
        .slice(open + 1, close)
        .replace(/\s+/g, " ")
        .trim(),
    });
  };
  for (const match of masked.matchAll(CALL))
    check((match.index as number) + match[0].length - 1, "git");
  for (const match of masked.matchAll(SPAWN))
    check((match.index as number) + match[0].length - 1, "spawn");
  return found.sort((a, b) => a.line - b.line);
}

/** The findings of every `.ts` file under `root`, files with none left out. */
export function unguardedInTree(root: string): GitArgFinding[] {
  const found: GitArgFinding[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts"))
        found.push(
          ...unguardedGitCalls(
            readFileSync(path, "utf8"),
            relative(root, path).replaceAll("\\", "/"),
          ),
        );
    }
  };
  walk(root);
  return found;
}
