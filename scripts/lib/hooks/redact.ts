/**
 * What a hook may show or log of a command: unprintable characters out and secrets hidden (#821, #945,
 * #1541, #1560). A lost pattern leaks a token into a refusal or a log, so these rules live apart.
 */

/** What the guard's log keeps of a refusal (#1541): its first line, printable, secrets hidden, clipped. */
export function blockDetail(reason: string): string {
  return redacted(printable(reason.split("\n")[0] ?? "")).slice(0, 160);
}

/** Text with control, format (bidi, zero-width), surrogate, private-use and line-separator characters out. */
export function printable(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, "");
}

/**
 * Token shapes of common services (#821 review): GitHub (also after a `_`), GitLab, npm, Slack,
 * OpenAI-style keys, AWS access keys and JWTs. Best effort: a reason is not a place for a secret.
 */
const TOKEN_SHAPES: readonly RegExp[] = [
  /(?:gh[pousr]_|github_pat_)\w+/g,
  /glpat-[\w-]+/g,
  /\bnpm_\w+/g,
  /xox[abprs]-[\w-]+/g,
  /\bsk-[\w-]{16,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g,
];

/** A command with the user and password of a URL, and a secret-looking variable's value, hidden. */
export function redacted(text: string): string {
  return (
    TOKEN_SHAPES.reduce(
      (out, shape) => out.replace(shape, "***"),
      text.replace(/:\/\/[^/@\s]+@/g, "://***@"),
    )
      .replace(/\b(Authorization:)\s*(?:(?:Basic|Bearer|Token)\s+)?\S+/gi, "$1 ***")
      .replace(
        /--((?:\w+-)*(?:token|password|passwd|secret|key))([= ])(?:"[^"]*"|'[^']*'|\S+)/gi,
        "--$1$2***",
      )
      .replace(/\b(Bearer)\s+\S+/gi, "$1 ***")
      // A header's whole value, to its closing quote or the end of the line (#1560 review).
      .replace(
        /\b((?:Set-)?Cookie|X-(?:Api-Key|Auth-Token|Amz-Security-Token)):\s*[^"'\n]*/gi,
        "$1: ***",
      )
      .replace(
        /\b(\w*(?:TOKEN|SECRET|PASSWORD|KEY|EXTRAHEADER)\w*)=(?:"[^"]*"|'[^']*'|\S+)/gi,
        "$1=***",
      )
  );
}
