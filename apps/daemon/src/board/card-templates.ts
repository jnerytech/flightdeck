/**
 * Issue #1201: a project's card templates (`.flightdeck/templates/cards.json`). The file is read
 * from a trusted project's trusted checkout only, like the validation template; this module judges
 * its text. A template with any mistake is left out and counted, never half used.
 */
import {
  CARD_TEMPLATES_MAX,
  type CardTemplate,
  type CardTemplates,
  PINNED_DOCS_MAX,
  pinnedDocProblem,
  specPathProblem,
} from "@flightdeck/protocol";
import { z } from "zod";

/** A name a person types in a file: one line, not blank, not a page. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text));

const Entry = z.object({
  id: line(60),
  name: line(80),
  description: z.string().max(4000).optional(),
  criteria: z.array(line(300)).max(30).optional(),
  workflow: line(100).optional(),
  persona: line(100).optional(),
  pins: z
    .array(z.string().refine((path) => pinnedDocProblem(path) === null))
    .max(PINNED_DOCS_MAX)
    .optional(),
  spec: z
    .string()
    .refine((path) => specPathProblem(path) === null)
    .optional(),
});

/** The template's text, then its criteria as the checklist the start contract reads (#78). */
function describe(entry: z.infer<typeof Entry>): string {
  const text = (entry.description ?? "").trim();
  const items = (entry.criteria ?? []).map((criterion) => `- [ ] ${criterion}`).join("\n");
  return [text, items].filter((part) => part !== "").join("\n\n");
}

/** The text of the file as the templates it offers. */
export function parseCardTemplates(
  text: string,
): Pick<CardTemplates, "templates" | "dropped"> & { invalid: boolean } {
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return { templates: [], dropped: 0, invalid: true };
  }
  if (!Array.isArray(list)) return { templates: [], dropped: 0, invalid: true };
  const templates: CardTemplate[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of list) {
    const parsed = Entry.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.id) || templates.length >= CARD_TEMPLATES_MAX) {
      dropped += 1;
      continue;
    }
    const entry = parsed.data;
    seen.add(entry.id);
    templates.push({
      id: entry.id,
      name: entry.name,
      description: describe(entry),
      workflow: entry.workflow ?? null,
      persona: entry.persona ?? null,
      pins: [...new Set(entry.pins ?? [])],
      spec: entry.spec ?? null,
    });
  }
  return { templates, dropped, invalid: false };
}
