import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const CALL = "new FlightdeckError(";

/** The source with comments blanked and string contents turned to "_" (same length, same offsets). */
function withoutComments(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") out[i++] = " ";
    } else if (c === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] !== "\n") out[i] = " ";
        i++;
      }
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const end = endOfString(source, i);
      for (let k = i + 1; k < end - 1; k++) if (source[k] !== "\n") out[k] = "_";
      i = end;
    } else i++;
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

/** How many top-level arguments the call whose `(` is at `open` has. */
function argumentCount(source: string, open: number): number {
  let depth = 0;
  let count = 0;
  let filled = false;
  let i = open;
  while (i < source.length) {
    const c = source[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(source, i);
      filled = true;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      if (depth > 1) filled = true;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return filled ? count + 1 : count;
    } else if (c === "," && depth === 1) {
      count++;
      filled = false;
    } else if (!/\s/.test(c) && depth >= 1 && i !== open) filled = true;
    i++;
  }
  return count;
}

/** `const name = (…) => new FlightdeckError(` : the name and where the call starts. */
const HELPER = /(?:export )?const (\w+) = \([^)]*\)(?::\s*[\w.]+)?\s*=>\s*new FlightdeckError\(/g;

/** How many refusals of a daemon source say nothing the app can translate (no reason). */
export function reasonlessRefusals(source: string): number {
  const text = withoutComments(source);
  const helperCalls = new Set<number>();
  const reasonless: string[] = [];
  for (const match of text.matchAll(HELPER)) {
    const open = (match.index as number) + match[0].length - 1;
    helperCalls.add(open - (CALL.length - 1));
    if (argumentCount(text, open) < 3) reasonless.push(match[1] as string);
  }
  let total = 0;
  for (let at = text.indexOf(CALL); at !== -1; at = text.indexOf(CALL, at + 1)) {
    if (helperCalls.has(at)) continue;
    if (argumentCount(text, at + CALL.length - 1) < 3) total++;
  }
  for (const name of reasonless) {
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
