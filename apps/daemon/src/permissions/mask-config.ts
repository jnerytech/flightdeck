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
const SCHEME =
  /^"(?:(?:bearer|basic)\s|[\w-]*(?:authorization|token|secret|key|passw\w*)[\w-]*\s*:)/i;

/** A `url` without the user in it and without its query or fragment, where a key is often passed. */
const bare = (value: string) =>
  value.replace(/\/\/[^/@"]*@/, "//[redacted]@").replace(/[?#].*"$/, '?[redacted]"');

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
  let owed = unknownStart;
  return lines.map((text) => {
    let out = "";
    let at = 0;
    let key = "";
    // Braces are counted on the line: an `env` or `headers` object ends at its own closing brace.
    let depth = 0;
    let privateAt = -1;
    for (const found of text.matchAll(STRING)) {
      const start = found.index;
      const end = start + found[0].length;
      for (const char of text.slice(at, start)) {
        if (char === "{") depth += 1;
        if (char === "}") {
          depth -= 1;
          if (depth <= privateAt) privateAt = -1;
        }
      }
      const inPrivate = privateAt >= 0;
      const before = text.slice(0, start).trimEnd().slice(-1);
      const listed = text.slice(0, start).lastIndexOf("[") > text.slice(0, start).lastIndexOf("]");
      let value = found[0];
      if (/^\s*:/.test(text.slice(end))) {
        key = value.slice(1, -1);
        owed = false;
        if (PRIVATE.has(key) && privateAt < 0) privateAt = depth;
      } else if (before === ":") {
        if (inPrivate || !SHOWN.has(key)) value = MASK;
        else if (key === "url") value = bare(value);
      } else {
        // A flag is judged by what it was, whether or not it is shown: the next one is its value.
        const flag = FLAG.exec(value);
        const secret = secretName(flag?.[1] ?? "");
        if (owed || inPrivate || SCHEME.test(value) || (listed && key !== "args")) {
          value = MASK;
        } else if (flag?.[2] && secret) {
          value = `"${flag[1]}=[redacted]"`;
        }
        owed = flag?.[2] === undefined && secret;
      }
      out += text.slice(at, start) + value;
      at = end;
    }
    out += text.slice(at);
    // A key at the end of a line owes its value to the next one.
    if (text.trimEnd().endsWith(":")) owed = true;
    return out
      .split(MASK)
      .map((part) => scanner.redact(part, false))
      .join(MASK);
  });
}
