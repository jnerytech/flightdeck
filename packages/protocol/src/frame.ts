// Issue #1609: the one place a frame's text becomes JSON, checked against its schema at once.
import type { z } from "zod";

/** `raw` parsed as JSON and checked against `schema`; throws when it is not JSON or does not fit. */
export function parseFrame<T>(schema: z.ZodType<T>, raw: string): T {
  return schema.parse(JSON.parse(raw));
}
