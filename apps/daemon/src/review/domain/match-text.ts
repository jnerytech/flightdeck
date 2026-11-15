import { SecretScanner } from "@flightdeck/protocol";

/** A line is cut to this many characters (code points, never half of one). */
const TEXT_MAX = 200;

/** Token shapes and private keys; the vault's values are the app's to mask (it has them). */
export const scanner = new SecretScanner();

/** What is read past the cut before the mask: a token across the cut is masked whole (#829). */
const MASK_WINDOW = 1024;

/**
 * A line that is one run of base64 inside quotes, a comment mark or a list's punctuation: a key's
 * body, which has no header on its line (#829). A heuristic: a long run needs mixed case and a
 * digit (so a word or a hex hash is not taken); a short one counts only with its `=` padding, as a
 * key's last line has.
 */
const BASE64_LINE = /^[\s"'`#/*,;:[\]-]*([A-Za-z0-9+/]+={0,2})[\s"'`,;\]]*$/; // NOSONAR: the line is cut to TEXT_MAX + MASK_WINDOW characters first

function keyBody(line: string): boolean {
  const run = BASE64_LINE.exec(line.replaceAll("\r", ""))?.[1] ?? "";
  const mixed = /[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run);
  return (run.length >= 24 && mixed) || (run.length >= 8 && run.endsWith("="));
}

/** A matched line as it is kept until it leaves: bounded in size, not masked yet. */
export const bounded = (text: string) =>
  text.replace(/\r?\n$/, "").slice(0, (TEXT_MAX + MASK_WINDOW) * 2);

/**
 * A matched line as it leaves the host: secrets masked, then cut to 200 characters. Masked before
 * the cut, so a token the cut would split is still seen whole and masked whole.
 */
export function shown(text: string): string {
  const window = Array.from(text)
    .slice(0, TEXT_MAX + MASK_WINDOW)
    .join("");
  const masked = keyBody(window) ? "[redacted]" : scanner.redact(window, false);
  return Array.from(masked).slice(0, TEXT_MAX).join("");
}
