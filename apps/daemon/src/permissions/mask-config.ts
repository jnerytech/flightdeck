/**
 * The one credential-listed file whose lines a reviewer must still read (#806): `.mcp.json` is
 * versioned, and a card that adds a server there adds a command that will run. Its diff and its
 * review comments show the lines with the values that may be secret masked; `file.read`, the
 * search and OpenCode's read rules keep treating it as a credential.
 */
import { SecretScanner } from "@flightdeck/protocol";
import { pathParts } from "./sensitive-paths.ts";

/** Whether a path names a config shown masked instead of left out. */
export const maskedConfig = (path: string): boolean => pathParts(path).at(-1) === ".mcp.json";

const scanner = new SecretScanner();
const MASK = '"[redacted]"';
/** A string property of a JSON line: its key (with the colon) and its value. */
const PROPERTY = /("(?:[^"\\]|\\.)*"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
/** A key that names a secret, wherever it is. */
const SECRET_KEY = /token|secret|key|passw|auth|credential|bearer|cookie|session/i;
/** The start of an object whose values are all private: a server's `env` and `headers`. */
const PRIVATE_BLOCK = /"(?:env|headers)"\s*:\s*\{/i;

const maskValues = (text: string, all: boolean) =>
  text.replace(PROPERTY, (whole, key: string) =>
    all || SECRET_KEY.test(key) ? `${key}${MASK}` : whole,
  );

/**
 * The lines of a config with its private values masked: every value in an `env` or `headers`
 * object, any value under a key that names a secret, and every token shape. The command and the
 * arguments of a server stay. A line is judged by what is in `lines` alone, so the masking of a
 * quote matches the masking of the whole file.
 */
export function maskConfig(lines: readonly string[]): string[] {
  let inBlock = false;
  return lines.map((text) => {
    let line: string;
    const opens = PRIVATE_BLOCK.exec(text);
    if (opens) {
      const head = text.slice(0, opens.index + opens[0].length);
      const rest = text.slice(head.length);
      line = head + maskValues(rest, true);
      inBlock = !rest.includes("}");
    } else if (inBlock) {
      line = maskValues(text, true);
      if (text.trimStart().startsWith("}")) inBlock = false;
    } else {
      line = maskValues(text, false);
    }
    // The token shapes in what is left; a masked value is not scanned again, or the scanner would
    // take the key with it and the line would no longer say which setting it was.
    return line
      .split(MASK)
      .map((part) => scanner.redact(part, false))
      .join(MASK);
  });
}
