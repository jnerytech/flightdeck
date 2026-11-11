/**
 * A JSON settings file as a person's editor saved it (#927, #1014): a Windows editor may start it
 * with a UTF-8 byte order mark and end its lines with CRLF. Every reader parses past the mark, and
 * every writer keeps the file's mark, indent and line endings.
 */
import type { z } from "zod";

const BOM = "\uFEFF";

/** The JSON of `text`, past a leading byte order mark. Throws as `JSON.parse` does. */
export function parseJsonText(text: string): unknown {
  return JSON.parse(text.startsWith(BOM) ? text.slice(BOM.length) : text);
}

/**
 * `value` as JSON laid out like `text` (its byte order mark, indent, line endings and final newline);
 * 2 spaces and a newline for a new file.
 */
export function layoutLike(text: string | null, value: unknown): string {
  if (text === null) return `${JSON.stringify(value, null, 2)}\n`;
  // The mark is kept, so writing back changes no byte of it.
  const bom = text.startsWith(BOM) ? BOM : "";
  const indent = /^\{\r?\n([ \t]+)"/.exec(text.slice(bom.length))?.[1] ?? 2;
  // Windows line endings stay Windows line endings (JSON.stringify escapes any newline in a value).
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const newline = text.endsWith("\n") ? eol : "";
  return `${bom}${JSON.stringify(value, null, indent).replaceAll("\n", eol)}${newline}`;
}

/**
 * The JSON of `text` checked against `schema`; throws when the text is not JSON or does not fit.
 * The error names where the text does not fit, never the text: it may hold a secret and ends in logs.
 */
export function parseJsonWith<T>(schema: z.ZodType<T>, text: string): T {
  let value: unknown;
  try {
    value = parseJsonText(text);
  } catch {
    throw new Error("text is not JSON");
  }
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const where = result.error.issues.map((issue) => issue.path.join(".") || "(root)");
  throw new Error(`JSON does not fit at ${[...new Set(where)].join(", ")}`);
}

/** Like `parseJsonWith`, but `fallback` for text that is not JSON or does not fit `schema`. */
export function parseJsonOr<T>(schema: z.ZodType<T>, text: string, fallback: T): T {
  try {
    return parseJsonWith(schema, text);
  } catch {
    return fallback;
  }
}
