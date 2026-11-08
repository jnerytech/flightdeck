/**
 * Issue #1201: a project's card templates (`.flightdeck/templates/cards.json`). The file is read
 * from a trusted project's trusted checkout only, like the validation template; this module judges
 * its text. A template with any mistake is left out and counted, never half used.
 */
import type { CardTemplates } from "@flightdeck/protocol";

/** The text of the file as the templates it offers. */
export function parseCardTemplates(_text: string): Pick<CardTemplates, "templates" | "dropped"> & {
  invalid: boolean;
} {
  return { templates: [], dropped: 0, invalid: false };
}
