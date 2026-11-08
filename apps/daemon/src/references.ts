/** One `{{ expression }}` found in a text. */
export interface Reference {
  /** The reference as written, braces included. */
  raw: string;
  /** What is between the braces, without the white space around it. */
  expression: string;
  /** Where it starts in the text. */
  index: number;
}

/** What `.` does not match: an expression stays on one line (white space around it may not). */
const LINE_END = String.raw`\r\n  `;
/** The expression: up to the first `}}` or the end of the line. */
const EXPRESSION = new RegExp(String.raw`(?:(?!\}\})[^${LINE_END}])*`, "y");
const SPACE = /\s*/y;
const SPACE_AND_CLOSE = /\s*\}\}/y;

/**
 * The `{{ expression }}` references of a text, left to right: the same ones the pattern
 * `\{\{\s*(.*?)\s*\}\}` found, in one pass. That pattern gave the white space back and took it
 * again at every `{{` it failed on, so its time grew with the cube of the length (Sonar S8786).
 * Here a failed `{{` is dropped at once, and so is every `{{` whose expression would end at the
 * same line break.
 */
export function referencesIn(text: string): Reference[] {
  const found: Reference[] = [];
  let from = 0;
  // A `{{` whose expression starts at or before this position ends at the same line break, and
  // no `}}` follows it: it fails like the one before.
  let failedAt = -1;
  for (;;) {
    const index = text.indexOf("{{", from);
    if (index === -1) return found;
    from = index + 1;
    SPACE.lastIndex = index + 2;
    SPACE.exec(text);
    const start = SPACE.lastIndex;
    if (start <= failedAt) continue;
    EXPRESSION.lastIndex = start;
    EXPRESSION.exec(text);
    const stop = EXPRESSION.lastIndex;
    let end = stop + 2;
    if (!text.startsWith("}}", stop)) {
      // The text ended, or a line break: only white space may stand between it and the `}}`.
      SPACE_AND_CLOSE.lastIndex = stop;
      if (!SPACE_AND_CLOSE.exec(text)) {
        failedAt = stop;
        continue;
      }
      end = SPACE_AND_CLOSE.lastIndex;
    }
    found.push({
      raw: text.slice(index, end),
      expression: text.slice(start, stop).trimEnd(),
      index,
    });
    from = end;
  }
}

/** `text` with each reference replaced by what `replace` gives for it (as `String.replace` does). */
export function replaceReferences(
  text: string,
  replace: (raw: string, expression: string) => string,
): string {
  let out = "";
  let last = 0;
  for (const { raw, expression, index } of referencesIn(text)) {
    out += text.slice(last, index) + replace(raw, expression);
    last = index + raw.length;
  }
  return out + text.slice(last);
}
