const HEADING_MAX = 120;

/** What a heading must not carry: controls, invisible and direction-changing characters, breaks. */
const NOT_FOR_A_HEADING = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * A front matter block (`---` lines at the very start): whether it says `draft: true` (as YAML
 * writes it: any case, quoted or not), and the text after it, where the heading is looked for.
 * Nothing else of it is kept. A block that does not close within what was read counts as a draft:
 * the check fails closed.
 */
function frontMatter(text: string): { draft: boolean; body: string } {
  const block = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!block) return { draft: /^\uFEFF?---\r?\n/.test(text), body: text };
  return {
    draft: /^draft:[ \t]*(["']?)true\1[ \t]*\r?$/im.test(block[1] ?? ""),
    body: text.slice(block[0].length),
  };
}

/** The first ATX heading of the start of a file, plain text of at most 120 characters. */
function firstHeading(text: string, cut: boolean): string | null {
  const lines = text.split(/\r?\n/);
  // A start that ended mid-line has a last line that may be half a heading.
  if (cut) lines.pop();
  for (const line of lines) {
    // `.` stops at U+2028 and U+2029; a line here ends only at a line feed.
    const opener = /^ {0,3}#{1,6}[ \t]+/.exec(line);
    if (!opener) continue;
    // A tab separates words; the other controls and invisible characters just go.
    const text = withoutClosing(line.slice(opener[0].length).replaceAll("\t", " ")).replace(
      NOT_FOR_A_HEADING,
      "",
    );
    if (text !== "") return Array.from(text).slice(0, HEADING_MAX).join("");
  }
  return null;
}

/** `Title ##` is `Title`; `C#` keeps its hash. Walks the line once. */
function withoutClosing(text: string): string {
  const trimmed = text.trimEnd();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "#") end -= 1;
  const separated = end === 0 || trimmed[end - 1] === " " || trimmed[end - 1] === "\t";
  return (end < trimmed.length && separated ? trimmed.slice(0, end) : trimmed).trimEnd();
}

/**
 * What the start of a spec file says: its first heading and whether its front matter marks it a
 * draft. `cut` is true when the text ended mid-line, so a last line that may be half a heading is
 * left out.
 */
export function specHeading(
  text: string,
  cut: boolean,
): { heading: string | null; draft: boolean } {
  const { draft, body } = frontMatter(text);
  return { heading: firstHeading(body, cut), draft };
}
