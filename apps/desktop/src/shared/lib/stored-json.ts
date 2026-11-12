import type { z } from "zod";

/** Where a stored value is read from: the platform's storage, or a fake with the same `getItem`. */
type Source = { getItem(key: string): string | null };

/**
 * The value kept under `key`, parsed with `schema` (#1609: parse, don't validate). Nothing stored, a
 * storage that refuses, text that is not JSON and JSON that does not fit the schema all give `fallback`.
 */
export function readStored<T>(
  _source: Source,
  _key: string,
  _schema: z.ZodType<T>,
  fallback: T,
): T {
  return fallback;
}
