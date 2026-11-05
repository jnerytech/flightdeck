import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const CALL = "new FlightdeckError(";

const isQuote = (c: string | undefined) => c === '"' || c === "'" || c === "`";

/** Blanks a `//` comment from `i`, up to the end of the line; returns where the line ends. */
function blankLineComment(source: string, out: string[], start: number): number {
  let i = start;
  while (i < source.length && source[i] !== "\n") out[i++] = " ";
  return i;
}

/** Blanks a `/* … *\/` comment from `i`, keeping its newlines; returns the index after it. */
function blankBlockComment(source: string, out: string[], start: number): number {
  let i = start;
  while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
    if (source[i] !== "\n") out[i] = " ";
    i++;
  }
  out[i] = " ";
  out[i + 1] = " ";
  return i + 2;
}

/** Turns the contents of the string that opens at `i` into "_"; returns the index after it. */
function maskString(source: string, out: string[], start: number): number {
  const end = endOfString(source, start);
  for (let k = start + 1; k < end - 1; k++) if (source[k] !== "\n") out[k] = "_";
  return end;
}

/** The source with comments blanked and string contents turned to "_" (same length, same offsets). */
function withoutComments(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === "/" && next === "/") i = blankLineComment(source, out, i);
    else if (c === "/" && next === "*") i = blankBlockComment(source, out, i);
    else if (isQuote(c)) i = maskString(source, out, i);
    else i++;
  }
  return out.join("");
}

/** The index after the string (or template) that opens at `start`; `${…}` may nest strings. */
function endOfString(source: string, start: number): number {
  const quote = source[start] as string;
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") i += 2;
    else if (c === quote) return i + 1;
    else if (quote === "`" && c === "$" && source[i + 1] === "{") i = endOfBraces(source, i + 1);
    else i++;
  }
  return i;
}

/** The index after the `{…}` that opens at `start`, strings inside included. */
function endOfBraces(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const c = source[i] as string;
    if (c === '"' || c === "'" || c === "`") i = endOfString(source, i);
    else {
      if (c === "{") depth++;
      if (c === "}" && --depth === 0) return i + 1;
      i++;
    }
  }
  return i;
}

interface ArgumentScan {
  depth: number;
  count: number;
  filled: boolean;
}

/** Moves the scan over one character outside strings; true when the call's closing bracket was met. */
function scanArgumentChar(scan: ArgumentScan, c: string, atOpen: boolean): boolean {
  if (c === "(" || c === "[" || c === "{") {
    scan.depth++;
    if (scan.depth > 1) scan.filled = true;
  } else if (c === ")" || c === "]" || c === "}") {
    scan.depth--;
    return scan.depth === 0;
  } else if (c === "," && scan.depth === 1) {
    scan.count++;
    scan.filled = false;
  } else if (!/\s/.test(c) && scan.depth >= 1 && !atOpen) scan.filled = true;
  return false;
}

/** How many top-level arguments the call whose `(` is at `open` has. */
function argumentCount(source: string, open: number): number {
  const scan: ArgumentScan = { depth: 0, count: 0, filled: false };
  let i = open;
  while (i < source.length) {
    const c = source[i] as string;
    if (isQuote(c)) {
      i = endOfString(source, i);
      scan.filled = true;
      continue;
    }
    if (scanArgumentChar(scan, c, i === open)) return scan.filled ? scan.count + 1 : scan.count;
    i++;
  }
  return scan.count;
}

/** `const name = (…) => new FlightdeckError(` : the name and where the call starts. */
const HELPER = /(?:export )?const (\w+) = \([^)]*\)(?::\s*[\w.]+)?\s*=>\s*new FlightdeckError\(/g;

/** The helpers that build a refusal with no reason, and where each helper's own `new` call starts. */
function reasonlessHelpers(text: string): { names: string[]; calls: Set<number> } {
  const calls = new Set<number>();
  const names: string[] = [];
  for (const match of text.matchAll(HELPER)) {
    const open = (match.index as number) + match[0].length - 1;
    calls.add(open - (CALL.length - 1));
    if (argumentCount(text, open) < 3) names.push(match[1] as string);
  }
  return { names, calls };
}

/** How many refusals of a daemon source say nothing the app can translate (no reason). */
export function reasonlessRefusals(source: string): number {
  const text = withoutComments(source);
  const helpers = reasonlessHelpers(text);
  let total = 0;
  for (let at = text.indexOf(CALL); at !== -1; at = text.indexOf(CALL, at + 1)) {
    if (helpers.calls.has(at)) continue;
    if (argumentCount(text, at + CALL.length - 1) < 3) total++;
  }
  for (const name of helpers.names) {
    total += [...text.matchAll(new RegExp(`(?<![\\w.])${name}\\(`, "g"))].length;
  }
  return total;
}

/** Every daemon source under `dir` with its count of reasonless refusals (none left out), keyed under `root`. */
export function refusalCounts(dir: string, root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.ts$/.test(entry.name)) {
        const n = reasonlessRefusals(readFileSync(path, "utf8"));
        if (n > 0) counts[relative(root, path).replaceAll("\\", "/")] = n;
      }
    }
  };
  walk(dir);
  return counts;
}
