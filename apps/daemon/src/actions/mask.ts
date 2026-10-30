/**
 * Phase 17: before anything goes back to Claude (or to the history), every delivered secret is
 * replaced in the output by `•••(name)`: the literal value, the lines of a multi-line one, and the
 * forms a program commonly prints it in (base64, URL-encoded, hex, JSON-escaped). A secret
 * transformed some other way is not caught: that is why the declared action is the safe path.
 */

export interface MaskedSecret {
  name: string;
  value: string;
}

/** A line of a multi-line secret shorter than this is not hidden: it would shred ordinary output. */
const MIN_LINE = 6;

/** The ways `value` may show up in a program's output. */
function forms(value: string): string[] {
  const bytes = Buffer.from(value, "utf8");
  const base64 = bytes.toString("base64");
  const url = encodeURIComponent(value);
  const json = JSON.stringify(value).slice(1, -1);
  return [
    value,
    json,
    base64,
    base64.replaceAll("+", "-").replaceAll("/", "_"),
    base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
    base64.replace(/=+$/, ""),
    url,
    url.toLowerCase(),
    url.replaceAll("%20", "+"),
    bytes.toString("hex"),
    bytes.toString("hex").toUpperCase(),
  ];
}

/** Every text that hides `secret`, longest first. */
function needlesOf(secret: MaskedSecret): string[] {
  const lines = secret.value.includes("\n")
    ? secret.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length >= MIN_LINE)
    : [];
  return [...forms(secret.value), ...lines.flatMap(forms)].filter((needle) => needle !== "");
}

/** The text with each secret's occurrences replaced; one pass, so a name written is not masked again. */
export function maskOutput(text: string, secrets: readonly MaskedSecret[]): string {
  const found: Array<{ start: number; end: number; name: string }> = [];
  for (const secret of secrets) {
    if (secret.value === "") continue;
    for (const needle of new Set(needlesOf(secret))) {
      let from = text.indexOf(needle);
      while (from !== -1) {
        found.push({ start: from, end: from + needle.length, name: secret.name });
        from = text.indexOf(needle, from + 1);
      }
    }
  }
  // Earliest first, and the longest of those that start together.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let at = 0;
  for (const hit of found) {
    if (hit.start < at) continue;
    out += `${text.slice(at, hit.start)}•••(${hit.name})`;
    at = hit.end;
  }
  return out + text.slice(at);
}
