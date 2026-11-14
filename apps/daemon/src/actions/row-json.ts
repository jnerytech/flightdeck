import { z } from "zod";
import { parseJsonWith } from "../kernel/index.ts";
import type { ActionDef } from "./domain/schema.ts";
import type { Fingerprint } from "./trust.ts";

/** The JSON columns of an action row, read through their schemas (#1609: parse, don't validate). */
/** Loose: a key the row holds but `ActionDef` does not name is kept, as the old cast kept it. */
const Definition: z.ZodType<ActionDef> = z.looseObject({
  name: z.string(),
  description: z.string(),
  host: z.string().optional(),
  ssh: z.string().optional(),
  run: z.array(z.string()),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()),
  params: z.record(
    z.string(),
    z.looseObject({ pattern: z.string(), default: z.string().optional() }),
  ),
  timeoutS: z.number(),
  approval: z.enum(["always", "never", "first-per-session"]).optional(),
  tags: z.array(z.string()).optional(),
});
const Files = z.record(z.string(), z.string());

/** The action a row declares. Throws when the column does not fit: nothing is run from a guess. */
export const definitionOf = (text: string): ActionDef => parseJsonWith(Definition, text);

/** The files a trust pinned. Throws when the column does not fit: a lost pin must not read as none. */
export const pinnedFilesOf = (text: string): Fingerprint["files"] => parseJsonWith(Files, text);
