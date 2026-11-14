/** The lines and Host patterns of an ssh config, as OpenSSH reads them (phase 15). */

/** `Key value` or `Key=value` as a lowercase key and an unquoted value; null for a line with no key. */
export function splitDirective(line: string): { key: string; value: string } | null {
  const match = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line); // NOSONAR: one line of an ssh config, not text of any length
  if (!match) return null;
  return { key: (match[1] as string).toLowerCase(), value: unquote((match[2] as string).trim()) };
}

/** An OpenSSH pattern (`*` and `?`) as a regular expression. */
function patternRegex(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${body}$`);
}

/** A Host line applies to a name when one of its patterns matches and no `!pattern` does. */
export function applies(patterns: string[], alias: string): boolean {
  const matches = (pattern: string) => patternRegex(pattern).test(alias);
  const positive = patterns.filter((p) => !p.startsWith("!"));
  const negative = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  return positive.some(matches) && !negative.some(matches);
}

export function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}
