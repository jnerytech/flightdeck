// Shared kernel: a text in both of the app's languages, used by every context that words something for the person (issue #1600: moved from index.ts).
import { z } from "zod";

/** A text in the two languages the app speaks; both are always written (phase 33). */
export const LocalizedText = z.object({ en: z.string().min(1), "pt-BR": z.string().min(1) });
export type LocalizedText = z.infer<typeof LocalizedText>;
