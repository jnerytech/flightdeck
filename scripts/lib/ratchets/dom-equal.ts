/**
 * DOM elements stay out of deep equality (issue #247). When `toEqual`, `toStrictEqual` or
 * `toMatchObject` fails with a happy-dom element on either side, Bun's diff formats the element's
 * whole object graph: one red assertion took 10 GB and the OOM killer. Bun has no limit on that
 * output, so the test sources are checked instead: compare what is read from an element
 * (`textContent`, `getAttribute`, `!== null`), never the element itself.
 */
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

/** Index of the closing quote of the string opened at `open` (past the end when it never closes). */
function stringEnd(src: string, open: number): number {
  const quote = src[open];
  let i = open + 1;
  for (; i < src.length && src[i] !== quote; i++) if (src[i] === "\\") i++;
  return i;
}

/** Index of the last char of the comment that starts at `i`; -1 when none starts there. */
function commentEnd(src: string, i: number): number {
  if (src[i] !== "/") return -1;
  if (src[i + 1] === "/") {
    const end = src.indexOf("\n", i);
    return end < 0 ? src.length : end;
  }
  if (src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    return end < 0 ? src.length : end + 1;
  }
  return -1;
}

/** Index just past the bracket that closes the one at `open`, skipping strings and comments. */
function closing(src: string, open: number): number {
  let depth = 0;
  let at = open;
  while (at < src.length) {
    const c = src[at] as string;
    const comment = commentEnd(src, at);
    if (c === '"' || c === "'" || c === "`") at = stringEnd(src, at);
    else if (comment >= 0) at = comment;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      depth--;
      if (depth === 0) return at + 1;
    }
    at++;
  }
  return src.length;
}

/** The code with every string's contents blanked, so a query's name inside text is not a call. */
function blanked(code: string): string {
  return code.replace(
    /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g,
    (_, quote: string, body: string) => `${quote}${" ".repeat(body.length)}${quote}`,
  );
}

/** A Testing Library or DOM query, or one of the document's own elements. */
const QUERY_CALL = String.raw`(?:get|query|find)(?:All)?By[A-Z]\w*|querySelector(?:All)?|getElementById|closest`;
const DOCUMENT_ELEMENT = String.raw`document\.(?:activeElement|body|documentElement)`;
const QUERY = new RegExp(String.raw`\b(?:${QUERY_CALL})\s*\(|\b${DOCUMENT_ELEMENT}\b`, "g");
/** What may follow a query and still leave the element itself: `!`, an index, `?? null`, `)`. */
const STILL_ELEMENT = /^(?:\s*(?:!(?!=)|\[\d+\]|\?\?\s*null|\)))*\s*$/;

/**
 * An object literal's key and its colon: whitespace, then key characters (a space counts as one),
 * then an optional `]`, whitespace and `:`. The key is the text before the first colon, so the
 * three forms below are told apart by what that text holds, and none of them backtracks:
 * a key with a character other than a space, a lone space before the `]`, and only whitespace
 * with a space in it.
 */
const KEY_CHAR = String.raw`[\w$"'[]`;
const KEY_WITH_CHARS = String.raw`\s*${KEY_CHAR}(?: *${KEY_CHAR})*(?: *\])?\s*`;
const KEY_SPACE_BRACKET = String.raw`\s* \]\s*`;
const KEY_SPACE_ONLY = String.raw`(?=\s*:)[^\S ]* \s*`;
const OBJECT_KEY = new RegExp(`^(?:${KEY_WITH_CHARS}|${KEY_SPACE_BRACKET}|${KEY_SPACE_ONLY}):`);

/** The top-level parts of a literal (`[a, b]`; `{ k: v }` gives v), each split again; else the code. */
function parts(code: string): string[] {
  const text = code.trim();
  const literal =
    (text.startsWith("[") || text.startsWith("{")) && closing(text, 0) === text.length;
  if (!literal) return [text.replace(/^\.\.\./, "")];
  const out: string[] = [];
  let start = 1;
  let at = 1;
  while (at < text.length - 1) {
    const c = text[at] as string;
    if ("([{".includes(c)) at = closing(text, at) - 1;
    else if (c === ",") {
      out.push(text.slice(start, at));
      start = at + 1;
    }
    at++;
  }
  out.push(text.slice(start, -1));
  return out
    .map((part) => (text.startsWith("{") ? part.replace(OBJECT_KEY, "") : part))
    .filter((part) => part.trim() !== "")
    .flatMap(parts);
}

/** Whether a value (an argument of `expect` or of the matcher) holds a DOM element itself. */
export function holdsElement(code: string): boolean {
  return parts(blanked(code)).some((part) => {
    let end = -1;
    for (const m of part.matchAll(QUERY)) {
      end = m[0].endsWith("(") ? closing(part, m.index + m[0].length - 1) : m.index + m[0].length;
    }
    return end >= 0 && STILL_ELEMENT.test(part.slice(end));
  });
}

const DEEP_MATCHER = /\s*(?:\.\s*not\s*)?\.\s*(?:toEqual|toStrictEqual|toMatchObject)\s*\(/y;

/** How many deep-equality assertions of a test source put a DOM element itself into the comparison. */
export function domEqualities(source: string): number {
  let count = 0;
  for (const m of source.matchAll(/\bexpect\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const end = closing(source, open);
    DEEP_MATCHER.lastIndex = end;
    const matcher = DEEP_MATCHER.exec(source);
    if (!matcher) continue;
    const argOpen = end + matcher[0].length - 1;
    const actual = source.slice(open + 1, end - 1);
    const expected = source.slice(argOpen + 1, closing(source, argOpen) - 1);
    if (holdsElement(actual) || holdsElement(expected)) count++;
  }
  return count;
}

/** Every test source under `dir` with its count (files at zero left out), keyed under `root`. */
export function domEqualCounts(dir: string, root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const path = resolve(entry.parentPath, entry.name);
    const n = domEqualities(readFileSync(path, "utf8"));
    if (n > 0) counts[relative(root, path).replaceAll("\\", "/")] = n;
  }
  return counts;
}
