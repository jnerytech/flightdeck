import type { CardTemplate } from "@flightdeck/protocol";
import type { T } from "@/i18n/index";

/** What a template put in the description, so a later pick can replace it and never the person's own words. */
export interface TemplateText {
  description: string;
  filled: string | null;
}

/**
 * The description after the person picked `picked` (`null`: a blank card): the template's text takes
 * the place of an empty description or of the text the last template put there, never of words the
 * person typed.
 */
export function applyTemplate(current: TemplateText, picked: CardTemplate | null): TemplateText {
  const replaceable = current.description.trim() === "" || current.description === current.filled;
  if (!replaceable) return current;
  const text = picked?.description ?? "";
  return { description: text, filled: text === "" ? null : text };
}

/** The workflow a card starts with: its template's, when the project still has it; else none. */
export function startWorkflowOf(card: { startWorkflow?: string | null }, names: string[]): string {
  const wanted = card.startWorkflow ?? null;
  return wanted !== null && names.includes(wanted) ? wanted : "";
}

/** The picker value of the persona a card starts in: its template's, when the host has it; else none. */
export function startPersonaOf(
  card: { startPersona?: string | null },
  hostPersonas: string[],
): string | null {
  const wanted = card.startPersona ?? null;
  return wanted !== null && hostPersonas.includes(wanted) ? `host:${wanted}` : null;
}

/** What the template sets besides the text, as one phrase; empty when it sets nothing. */
export function startsWith(t: T, template: CardTemplate): string {
  const parts = [
    template.workflow && t("kanban.templateWorkflow", { name: template.workflow }),
    template.persona && t("kanban.templatePersona", { name: template.persona }),
    template.pins.length > 0 && t("kanban.templatePins", { n: template.pins.length }),
    template.spec && t("kanban.templateSpec", { path: template.spec }),
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? t("kanban.templateStarts", { parts: parts.join(", ") }) : "";
}
