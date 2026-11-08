/**
 * A weakened assertion (#1141): docs/TDD.md forbids weakening an assertion to make a test pass. An
 * edit weakens when, within that one edit, strict matchers go down and weak ones go up, or when an
 * `expect(subject)` that had a strict matcher keeps only a weak one (#1143 review). A weak matcher
 * on a line with `// weaker: <why>` is a reviewed swap and does not count.
 */

type Kind = "strict" | "weak" | "neutral";

/** One `expect(subject)…matcher(args)` of a text. */
interface Assertion {
  subject: string;
  kind: Kind;
  escaped: boolean;
}

/** Matchers that name the value they expect. */
const STRICT = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toContain",
  "toContainEqual",
  "toMatch",
  "toMatchObject",
  "toThrow",
  "toHaveLength",
  "toHaveBeenCalledWith",
  "toHaveBeenNthCalledWith",
  "toHaveBeenLastCalledWith",
]);

/** Matchers that only say something is there, is truthy, or is of a kind. */
const WEAK = new Set([
  "toBeTruthy",
  "toBeDefined",
  "toBeFalsy",
  "toHaveBeenCalled",
  "toBeInstanceOf",
]);

/** An argument that names no value: `expect.anything()`, `expect.any(…)`, an empty object. */
const VAGUE_ARG =
  /^(?:expect\.anything\(\)|expect\.any\(|expect\.objectContaining\(\{\s*\}\)$|\{\s*\}$)/;

/**
 * A subject that is itself a comparison or a type test, so `toBe(true)` says no more than
 * `not.toBeNull()` or `toBeInstanceOf(X)`.
 */
const COMPARISON = /[!=]==?|[<>]|\binstanceof\b|\btypeof\b/;

/** The reviewed escape: `// weaker: ` and at least one word of why. */
const ESCAPE = /\/\/ weaker: \S/;

/** The index just past the `)` that closes the `(` before `from`, skipping strings; -1 if none. */
function closing(text: string, from: number, limit = 2000): number {
  let depth = 1;
  let quote = "";
  const end = Math.min(text.length, from + limit);
  for (let i = from; i < end; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/** The matcher after a subject: `.not`, `.resolves`, `.rejects` and then `.<name>(`. */
const MATCHER = /^(?:\s*\.\s*(not|resolves|rejects))*\s*\.\s*(\w+)\(/;

function kindOf(name: string, negated: boolean, args: string, subject: string): Kind {
  const arg = args.trim();
  if (negated) return name === "toBeNull" || name === "toBeUndefined" ? "weak" : "neutral";
  if (WEAK.has(name)) return "weak";
  if (name === "toBeGreaterThan" && arg === "0") return "weak";
  if (!STRICT.has(name)) return "neutral";
  if (name === "toThrow" && arg === "") return "weak";
  if (VAGUE_ARG.test(arg)) return "weak";
  if (name === "toBe" && /^(?:true|false)\s*,?$/.test(arg) && COMPARISON.test(subject)) {
    return "neutral";
  }
  return "strict";
}

/** Every assertion of a text, with its subject, kind and escape. */
function assertions(text: string): Assertion[] {
  const found: Assertion[] = [];
  let at = text.indexOf("expect(");
  while (at !== -1) {
    const open = at + "expect(".length;
    // A subject is short; its matcher's arguments may be a whole object.
    const close = closing(text, open, 500);
    if (close === -1) {
      // An unclosed `expect(` (in a comment, say) hides nothing after it.
      at = text.indexOf("expect(", open);
      continue;
    }
    const matcher = MATCHER.exec(text.slice(close, close + 200));
    if (matcher) {
      const argsFrom = close + matcher[0].length;
      const argsTo = closing(text, argsFrom);
      const args = argsTo === -1 ? "" : text.slice(argsFrom, argsTo - 1);
      const raw = text.slice(open, close - 1);
      const subject = raw.replace(/\s+/g, "");
      // The escape follows the matcher on its line: read at most 500 characters of it, so a
      // long one-line edit costs the same per assertion (security review).
      const line = text.slice(argsFrom, argsFrom + 500).split("\n")[0] ?? "";
      const negated = /\.\s*not\b/.test(matcher[0]);
      const kind = kindOf(matcher[2] ?? "", negated, args, raw);
      found.push({ subject, kind, escaped: kind === "weak" && ESCAPE.test(line) });
    }
    at = text.indexOf("expect(", close);
  }
  return found;
}

/** How many strict and weak matchers a text holds; `escaped` counts the `// weaker:` ones. */
export function assertionCounts(text: string): { strict: number; weak: number; escaped: number } {
  const counts = { strict: 0, weak: 0, escaped: 0 };
  for (const a of assertions(text)) {
    if (a.kind === "strict") counts.strict += 1;
    else if (a.kind === "weak" && a.escaped) counts.escaped += 1;
    else if (a.kind === "weak") counts.weak += 1;
  }
  return counts;
}

/** Whether replacing `before` with `after` swaps strict matchers for weak ones. */
export function weakensAssertions(before: string, after: string): boolean {
  const was = assertionCounts(before);
  const now = assertionCounts(after);
  if (now.strict < was.strict && now.weak > was.weak) return true;
  // Per subject: one that had a strict check and keeps only an unescaped weak one.
  const strictBefore = new Set(
    assertions(before)
      .filter((a) => a.kind === "strict")
      .map((a) => a.subject),
  );
  const nowBySubject = new Map<string, Assertion[]>();
  for (const a of assertions(after)) {
    const list = nowBySubject.get(a.subject);
    if (list) list.push(a);
    else nowBySubject.set(a.subject, [a]);
  }
  for (const subject of strictBefore) {
    const now = nowBySubject.get(subject) ?? [];
    if (now.some((a) => a.kind === "weak" && !a.escaped) && !now.some((a) => a.kind === "strict")) {
      return true;
    }
  }
  return false;
}
