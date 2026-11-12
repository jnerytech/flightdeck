import { z } from "zod";

/** Where a stored value is read from: the platform's storage, or a fake with the same `getItem`. */
type Source = { getItem(key: string): string | null };

/**
 * The value kept under `key`, parsed with `schema` (#1609: parse, don't validate). Nothing stored, a
 * storage that refuses, text that is not JSON and JSON that does not fit the schema all give `fallback`.
 */
export function readStored<T>(source: Source, key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const text = source.getItem(key);
    return text === null ? fallback : parseJsonText(text, schema, fallback);
  } catch {
    // A storage that refuses to answer: nothing usable is kept.
    return fallback;
  }
}

/** `text` parsed with `schema`; text that is not JSON, or JSON that does not fit, gives `fallback`. */
export function parseJsonText<T>(text: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** A stored list read leniently: an item that does not fit `item` is dropped, the others stay. */
export const validItems = <T>(item: z.ZodType<T>) =>
  z.array(z.unknown()).transform((items) =>
    items.flatMap((each) => {
      const parsed = item.safeParse(each);
      return parsed.success ? [parsed.data] : [];
    }),
  );

/** A stored record read leniently: a value that does not fit `value` is dropped, the others stay. */
export const validValues = <T>(value: z.ZodType<T>) =>
  z.record(z.string(), z.unknown()).transform((all) =>
    Object.fromEntries(
      Object.entries(all).flatMap(([key, each]) => {
        const parsed = value.safeParse(each);
        return parsed.success ? [[key, parsed.data]] : [];
      }),
    ),
  );
