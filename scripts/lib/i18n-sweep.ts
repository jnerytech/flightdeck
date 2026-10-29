/** Visible text written straight into a screen instead of coming from the dictionary. */
export interface Literal {
  line: number;
  text: string;
}

const LETTER = /\p{L}/u;
/** Text between two tags, with no expression in it (`=>` is an arrow, not a tag). */
const JSX_TEXT = /(?<!=)>([^<>{}]+)</g;
/** Attributes a user reads or hears. */
const ATTRIBUTE = /\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g;
/** A template literal as a JSX child: its static parts are visible text. */
const TEMPLATE = /\{`([^`]*)`\}/g;

/**
 * JSX text, visible attributes (`aria-label`, `title`, `placeholder`, `alt`) and template literals
 * with letters, in source order; `allowed` holds exact texts that are not translated (names).
 */
export function visibleLiterals(source: string, allowed: readonly string[] = []): Literal[] {
  const found: Array<Literal & { at: number }> = [];
  source.split("\n").forEach((text, i) => {
    const line = i + 1;
    const keep = (at: number, shown: string, visible: string) => {
      if (LETTER.test(visible) && !allowed.includes(visible.trim())) {
        found.push({ line, text: shown, at });
      }
    };
    for (const m of text.matchAll(JSX_TEXT)) keep(m.index, (m[1] ?? "").trim(), m[1] ?? "");
    for (const m of text.matchAll(ATTRIBUTE)) keep(m.index, m[0], m[1] ?? "");
    for (const m of text.matchAll(TEMPLATE)) {
      keep(m.index, m[0], (m[1] ?? "").replaceAll(/\$\{[^}]*\}/g, ""));
    }
  });
  return found
    .sort((a, b) => a.line - b.line || a.at - b.at)
    .map(({ line, text }) => ({ line, text }));
}
