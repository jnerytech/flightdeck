import type { CardTemplate, CardTemplates } from "@flightdeck/protocol";

/** What a template put in the description, so a later pick can replace it and never the person's own words. */
export interface TemplateText {
  description: string;
  filled: string | null;
}

/**
 * The description after the person picked `picked` (`null`: a blank card): the template's text takes
 * the place of an empty description or of the text the last template put there, never of words the
 * person typed. Stub.
 */
export function applyTemplate(current: TemplateText, _picked: CardTemplate | null): TemplateText {
  return current;
}

/** The workflow a card starts with: its template's, when the project still has it; else none. Stub. */
export function startWorkflowOf(_card: { startWorkflow: string | null }, _names: string[]): string {
  return "";
}

/** The picker value of the persona a card starts in: its template's, when the host has it; else none. Stub. */
export function startPersonaOf(
  _card: { startPersona: string | null },
  _hostPersonas: string[],
): string | null {
  return null;
}

export type { CardTemplates };

/** The New card dialog's template picker; stub. */
export function CardTemplateField(
  _props: Readonly<{
    store: unknown;
    hostId: string;
    projectId: string;
    enabled: boolean;
    value: string | null;
    onPick(template: CardTemplate | null): void;
  }>,
) {
  return null;
}
