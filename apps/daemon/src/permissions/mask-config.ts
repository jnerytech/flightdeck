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
/** One string of a JSON line, with what is just after it (a colon makes it a key). */
const STRING = /"(?:[^"\\]|\\.)*"/g;
/** The keys whose values say what a server runs and where: everything else is masked. */
const SHOWN = new Set(["command", "type", "transport", "name", "cwd", "url"]);
/** An argument that names a secret: the next one is its value. */
const SECRET_FLAG = /^"--?[\w-]*(token|key|secret|passw|auth|cred|bearer)[\w-]*"$/i;

/** A `url` without its query or fragment, where a key is often passed. */
const bare = (value: string) => value.replace(/[?#].*"$/, '?[redacted]"');

/**
 * The lines of a config with its private values masked. Fail-closed, line by line: a string
 * value is shown only under `command`, `type`, `transport`, `name`, `cwd` and `url` (without its
 * query); an argument in a list is shown unless it follows a flag that names a secret; the keys
 * and everything that is not a string stay, and token shapes are masked in what is left. No line
 * depends on the ones around it, so a hunk that starts inside an object is masked as well as the
 * whole file.
 */
export function maskConfig(lines: readonly string[]): string[] {
  let flagged = false;
  return lines.map((text) => {
    let out = "";
    let at = 0;
    let key = "";
    for (const found of text.matchAll(STRING)) {
      const start = found.index;
      const end = start + found[0].length;
      const before = text.slice(0, start).trimEnd().slice(-1);
      const isKey = /^\s*:/.test(text.slice(end));
      let value = found[0];
      if (isKey) {
        key = value.slice(1, -1).toLowerCase();
        flagged = false;
      } else if (before === ":") {
        if (!SHOWN.has(key)) value = MASK;
        else if (key === "url") value = bare(value);
      } else if (flagged) {
        value = MASK;
        flagged = false;
      } else {
        flagged = SECRET_FLAG.test(value);
      }
      out += text.slice(at, start) + value;
      at = end;
    }
    out += text.slice(at);
    return out
      .split(MASK)
      .map((part) => scanner.redact(part, false))
      .join(MASK);
  });
}
