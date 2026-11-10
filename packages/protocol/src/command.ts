// Issue #1600: the shape of one command of the `Command` union, shared by the context files.
import { z } from "zod";

/** One command: its id, its `type` and its payload. Not exported from the package's entry. */
export const cmd = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ id: z.string().min(1), type: z.literal(type), payload });
