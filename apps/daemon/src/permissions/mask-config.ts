/**
 * The one credential-listed file whose lines a reviewer must still read (#806): `.mcp.json` is
 * versioned, and a card that adds a server there adds a command that will run. Its diff and its
 * review comments show the lines with every value masked but the ones a reviewer needs to read;
 * `file.read`, the search and OpenCode's read rules keep treating it as a credential.
 */
import { SecretScanner } from "@flightdeck/protocol";
import { credential, pathParts } from "./sensitive-paths.ts";

/**
 * Whether a path names the config shown masked instead of left out: `.mcp.json`, unless a folder
 * above it is a credential folder (`.aws/.mcp.json` is one).
 */
export function maskedConfig(path: string): boolean {
  const parts = pathParts(path);
  return parts.at(-1) === ".mcp.json" && !credential(parts.slice(0, -1).join("/"));
}

const scanner = new SecretScanner();
const MASK = '"[redacted]"';
/** One string of a JSON line. */
const STRING = /"(?:[^"\\]|\\.)*"/g;
/** The keys whose values say what a server runs and where; case-sensitive, as Claude Code reads them. */
const SHOWN = new Set(["command", "type", "transport", "cwd", "url"]);
/** The objects whose values are all private; the rest of the line is masked after one. */
const PRIVATE = new Set(["env", "headers"]);

/** Whether a flag's name says its value is a secret (`--token`, `--api-key`, `--db-pwd`, not `--path`). */
const secretName = (name: string) =>
  /token|secret|passw|credential|apikey|bearer/i.test(name) ||
  name.split("-").some((part) => /^(key|pwd|pat|dsn|sig|auth|cred)$/i.test(part));
const FLAG = /^"(--?[\w-]+)(=.*)?"$/;
/** A header passed as a list item (`Bearer x`, `Authorization: x`, `X-Api-Key: x`): a secret whatever the key. */
const SCHEME = /^"(?:bearer|basic)\s/i;
/** The key of a `Key: value` item: one run of word characters, so it is read in a single pass. */
const HEADER_KEY = /^"([\w-]*)\s*:/;
const SECRET_WORD = /authorization|token|secret|key|passw/i;
const isScheme = (value: string) =>
  SCHEME.test(value) || SECRET_WORD.test(HEADER_KEY.exec(value)?.[1] ?? "");

/** A `url` without the user in it and without its query or fragment, where a key is often passed. */
const bare = (value: string) => {
  const hidden = value.replace(/\/\/[^/@"]*@/, "//[redacted]@");
  const cut = hidden.search(/[?#]/);
  return cut < 0 ? hidden : `${hidden.slice(0, cut)}?[redacted]"`;
};

/**
 * The lines of a config with its private values masked. Fail-closed, and line by line: a string
 * value is shown only under `command`, `type`, `transport`, `cwd` and `url` (without its user and
 * query) and never in an `env` or `headers` object on the same line; a list item is shown only
 * in an `args` list or on a line of its own, unless it follows a flag that names a secret, is
 * joined to one, or names a scheme. A value on the line after its key is masked. `unknownStart`
 * is for a diff hunk, which may open inside an object or on a flag's value: its first string
 * is masked. Keys, numbers and punctuation stay, and token shapes are masked in what is left.
 */
export function maskConfig(lines: readonly string[], unknownStart = false): string[] {
  // The next string with no key before it is a value that belongs to something unseen.
  const carry = { owed: unknownStart };
  return lines.map((text) => maskLine(text, carry));
}

/** What one line has seen so far, a string at a time. */
interface Scan {
  /** The next string with no key before it is a value that belongs to something unseen. */
  owed: boolean;
  key: string;
  /** Braces are counted on the line: an `env` or `headers` object ends at its own closing brace. */
  depth: number;
  privateAt: number;
}

/** One line masked; `carry.owed` goes in as the line starts and comes out as it ends. */
function maskLine(text: string, carry: { owed: boolean }): string {
  const scan: Scan = { owed: carry.owed, key: "", depth: 0, privateAt: -1 };
  let out = "";
  let at = 0;
  for (const found of text.matchAll(STRING)) {
    const start = found.index;
    const end = start + found[0].length;
    countBraces(scan, text.slice(at, start));
    out += text.slice(at, start) + maskString(scan, text, found[0], start, end);
    at = end;
  }
  out += text.slice(at);
  // A key at the end of a line owes its value to the next one.
  carry.owed = scan.owed || text.trimEnd().endsWith(":");
  return out
    .split(MASK)
    .map((part) => scanner.redact(part, false))
    .join(MASK);
}

/** The braces between two strings: an `env` or `headers` object is over at its closing brace. */
function countBraces(scan: Scan, between: string): void {
  for (const char of between) {
    if (char === "{") scan.depth += 1;
    if (char === "}") {
      scan.depth -= 1;
      if (scan.depth <= scan.privateAt) scan.privateAt = -1;
    }
  }
}

/** A string of the line as it is shown: a key as it is, a value or a list item masked unless it may be read. */
function maskString(scan: Scan, text: string, value: string, start: number, end: number): string {
  const inPrivate = scan.privateAt >= 0;
  if (/^\s*:/.test(text.slice(end))) {
    scan.key = value.slice(1, -1);
    scan.owed = false;
    if (PRIVATE.has(scan.key) && scan.privateAt < 0) scan.privateAt = scan.depth;
    return value;
  }
  const head = text.slice(0, start);
  if (head.trimEnd().endsWith(":")) {
    if (inPrivate || !SHOWN.has(scan.key)) return MASK;
    return scan.key === "url" ? bare(value) : value;
  }
  return maskItem(scan, value, inPrivate, head.lastIndexOf("[") > head.lastIndexOf("]"));
}

/** A string with no key before it: a list item, a flag or the value of a flag. */
function maskItem(scan: Scan, value: string, inPrivate: boolean, listed: boolean): string {
  // A flag is judged by what it was, whether or not it is shown: the next one is its value.
  const flag = FLAG.exec(value);
  const secret = secretName(flag?.[1] ?? "");
  let shown = value;
  if (scan.owed || inPrivate || isScheme(value) || (listed && scan.key !== "args")) {
    shown = MASK;
  } else if (flag?.[2] && secret) {
    shown = `"${flag[1]}=[redacted]"`;
  }
  scan.owed = flag?.[2] === undefined && secret;
  return shown;
}
