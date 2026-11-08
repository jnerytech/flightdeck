/**
 * Issue #1249: the card templates the demo's design-system project commits
 * (`.flightdeck/templates/cards.json`), so New card's template picker has a print. The project is
 * trusted in the seed; the template sets every part the picker's "Starts with" line names.
 */

/** The template's name in the picker: the print picks it by this name. */
export const DEMO_CARD_TEMPLATE = "Mudança de token";

/** The text of the file the seed commits. */
export function demoCardTemplates(): string {
  return JSON.stringify(
    [
      {
        id: "token",
        name: DEMO_CARD_TEMPLATE,
        description: "Mude um token e confira as telas que o usam.",
        criteria: ["as telas claras e escuras conferem", "o tokens.json segue a única fonte"],
        workflow: "feature",
        // A persona of the host (~/.claude/agents in the demo's home).
        persona: "pessoal",
        // The library's valid ADR (KNOWLEDGE_DOCS in demo-seed.ts). Paths of the demo's repository,
        // built so they are not read as docs of this one (md-links).
        pins: [["docs", "adr", "0001-design-tokens.md"].join("/")],
        spec: ["docs", "specs", "token-change.md"].join("/"),
      },
    ],
    null,
    2,
  );
}
