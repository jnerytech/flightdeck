/**
 * The frontmatter of an agent or skill file, read and written without losing what the form does
 * not edit: every line of the block that is not a field it changes comes back as it was.
 */

/** One `key: value` of the block; `raw` is the value as the file spells it (quotes included). */
export interface Entry {
  key: string;
  value: string;
  raw: string;
  /** A value over several lines (`>`, `|`, a list): kept as it is, not a field to edit. */
  complex?: boolean;
}

export interface Document {
  entries: Entry[];
  body: string;
  eol: string;
}

const KEY = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/;

/** The text of a YAML scalar: quotes taken off, the escapes undone. */
function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw;
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  return raw;
}

/** How a value is written: as it is, unless YAML would read it as something else. */
function quote(value: string): string {
  if (value.startsWith("[") && value.endsWith("]")) return value;
  return /^[[{|>&*!%@`'"#?-]|: | #|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
}

export function parseDocument(content: string): Document {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (close === -1) return { entries: [], body: content, eol };
  const entries: Entry[] = [];
  let i = 1;
  while (i < close) {
    const line = lines[i] as string;
    const match = KEY.exec(line);
    i++;
    if (!match) continue;
    const block = [line];
    while (i < close && /^(\s|-)/.test(lines[i] as string)) block.push(lines[i++] as string);
    const key = match[1] as string;
    const raw = match[2] ?? "";
    const complex = block.length > 1 || /^[|>]/.test(raw) || raw === "";
    entries.push(
      complex
        ? { key, value: "", raw: block.join(eol), complex: true }
        : { key, value: unquote(raw), raw },
    );
  }
  return { entries, body: lines.slice(close + 1).join(eol), eol };
}

/** The value of a field the form can edit; `undefined` when it is absent or spans lines. */
export function getField(doc: Document, key: string): string | undefined {
  const entry = doc.entries.find((e) => e.key === key);
  return entry && !entry.complex ? entry.value : undefined;
}

/** Sets a field (an empty value removes it). The others keep their text and their order. */
export function setField(doc: Document, key: string, value: string): Document {
  const index = doc.entries.findIndex((e) => e.key === key);
  if (index === -1) {
    return value === ""
      ? doc
      : { ...doc, entries: [...doc.entries, { key, value, raw: quote(value) }] };
  }
  const entries = [...doc.entries];
  if (value === "") entries.splice(index, 1);
  else if (value !== entries[index]?.value) entries[index] = { key, value, raw: quote(value) };
  return { ...doc, entries };
}

export function serialize(doc: Document): string {
  if (doc.entries.length === 0) return doc.body;
  const lines = doc.entries.map((e) => (e.complex ? e.raw : `${e.key}: ${e.raw}`));
  return ["---", ...lines, "---"].join(doc.eol) + doc.eol + doc.body;
}
