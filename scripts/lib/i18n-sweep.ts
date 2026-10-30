/** Visible text written straight into a screen instead of coming from the dictionary. */
export interface Literal {
  line: number;
  text: string;
}

const LETTER = /\p{L}/u;
/** Text between two tags, on one line or several (`=>` is an arrow, not a tag). */
const JSX_TEXT = /(?<!=)>([^<>{}]+)</g;
/** Code that only looks like text between `>` and `<` (a comparison, not a tag's content). */
const CODE = /[;=()&|]/;
/** Attributes and props a user reads or hears. */
const ATTRIBUTE =
  /\b(?:aria-label|title|placeholder|alt|subtitle|message|confirmLabel|label)="([^"]*)"/g;
/** A template literal as a JSX child: its static parts are visible text. */
const TEMPLATE = /\{`([^`]*)`\}/g;

/**
 * JSX text, visible attributes and props (`aria-label`, `title`, `placeholder`, `alt`, `subtitle`,
 * `message`, `confirmLabel`, `label`) and template literals with letters, in source order;
 * `allowed` holds exact texts that are not translated (names).
 */
export function visibleLiterals(source: string, allowed: readonly string[] = []): Literal[] {
  const found: Array<Literal & { at: number }> = [];
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  const keep = (at: number, shown: string, visible: string) => {
    if (LETTER.test(visible) && !allowed.includes(visible.trim())) {
      found.push({ line: lineOf(at), text: shown, at });
    }
  };
  for (const m of source.matchAll(JSX_TEXT)) {
    const text = m[1] ?? "";
    if (CODE.test(text)) continue;
    // The line is the one the words are on, not the one the tag ends on.
    keep(m.index + 1 + text.length - text.trimStart().length, text.trim(), text);
  }
  let offset = 0;
  for (const line of source.split("\n")) {
    for (const m of line.matchAll(ATTRIBUTE)) keep(offset + m.index, m[0], m[1] ?? "");
    for (const m of line.matchAll(TEMPLATE)) {
      const fixed = (m[1] ?? "").replaceAll(/\$\{[^}]*\}/g, "");
      // Ids and keys (`${id}-sub`) are code: text has a space or an accent.
      if (/[\sÀ-ɏ]/.test(fixed)) keep(offset + m.index, m[0], fixed);
    }
    offset += line.length + 1;
  }
  return found.sort((a, b) => a.at - b.at).map(({ line, text }) => ({ line, text }));
}
