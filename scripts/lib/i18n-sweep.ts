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
  return [...found].sort((a, b) => a.at - b.at).map(({ line, text }) => ({ line, text }));
}

const STRING = String.raw`"(?:[^"\\]|\\.)*"|` + "`(?:[^`\\\\]|\\\\.)*`";
/** Properties whose string is shown to a person: `label: "Abrir"`, `title: "Ações"`. */
const KEYED = new RegExp(
  String.raw`\b(?:label|title|detail|body|error|message|text|placeholder|description|shortcutProblem)\s*:\s*(${STRING})`,
  "g",
);
/** A failure the banner shows: `fail("…")`, `this.fail(error, "…")`. */
const FAIL = new RegExp(String.raw`\bfail\(\s*(?:[^,()]+,\s*)?(${STRING})`, "g");
const ANY_STRING = new RegExp(STRING, "g");
/** Letters only Portuguese uses: a string with one is text for a person. */
const ACCENT = /[áâãàéêíóôõúç]/i;
/** Words only Portuguese uses and no English text does (accented ones are ACCENT's). */
const PORTUGUESE =
  /\b(?:sem|para|este|esta|isso|fora|dados|antes|depois|erro|arquivo|resposta|desconhecido|existe|encontrad[oa]|nenhum|nenhuma|veio|confira|salvar|pasta|chamado|perdida|suportada)\b/i;
/** A thrown error is for the log, but a refusal shows its message as the detail: only Portuguese counts. */
const THROWN = /\bnew (?:Request)?Error\(|\bthrow\b/;
/** Lines that are not code that runs: comments and imports. */
const NOT_CODE = /^\s*(?:\/\/|\*|\/\*)|^\s*import\b/;
const TEMPLATE_HOLE = /\$\{[^}]*\}/g;

/**
 * Visible text written outside the JSX, which the `visibleLiterals` sweep cannot see: values of
 * `label`, `title`, `detail`, `body`, `error`, `message`… in objects, the text of a `fail(…)`, and
 * any other string with a Portuguese accent (a table of names). A template literal counts by its
 * static parts. Comments are left out, and so are thrown errors unless they are in Portuguese (an
 * accent or one of its words); `allowed` holds untranslated names.
 */
export function visibleTsLiterals(source: string, allowed: readonly string[] = []): Literal[] {
  const found: Array<Literal & { at: number }> = [];
  let offset = 0;
  source.split("\n").forEach((line, i) => {
    if (!NOT_CODE.test(line)) {
      const seen = new Set<number>();
      const keep = (index: number, quoted: string) => {
        if (seen.has(index)) return;
        seen.add(index);
        const text = quoted
          .slice(1, -1)
          .replaceAll(TEMPLATE_HOLE, "")
          .replaceAll(/\s+/g, " ")
          .trim();
        if (LETTER.test(text) && !allowed.includes(text)) {
          found.push({ line: i + 1, text, at: offset + index });
        }
      };
      if (!THROWN.test(line)) {
        for (const pattern of [KEYED, FAIL]) {
          for (const m of line.matchAll(pattern)) {
            const quoted = m[1] as string;
            keep(m.index + m[0].length - quoted.length, quoted);
          }
        }
      }
      for (const m of line.matchAll(ANY_STRING)) {
        if (ACCENT.test(m[0]) || PORTUGUESE.test(m[0].replaceAll(TEMPLATE_HOLE, ""))) {
          keep(m.index, m[0]);
        }
      }
    }
    offset += line.length + 1;
  });
  return [...found].sort((a, b) => a.at - b.at).map(({ line, text }) => ({ line, text }));
}
