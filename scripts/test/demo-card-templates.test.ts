import { describe, expect, test } from "bun:test";
import { parseCardTemplates } from "../../apps/daemon/src/board/card-templates.ts";
import { DEMO_CARD_TEMPLATE, demoCardTemplates } from "../lib/demo-card-templates.ts";

describe("demoCardTemplates (#1249)", () => {
  test("the host takes the demo's file whole: one template, none left out", () => {
    const parsed = parseCardTemplates(demoCardTemplates());
    expect(parsed.invalid).toBe(false);
    expect(parsed.dropped).toBe(0);
    expect(parsed.templates.map((template) => template.name)).toEqual([DEMO_CARD_TEMPLATE]);
  });

  test("it sets every part New card's 'Starts with' line names, and pins a document of the library", () => {
    const [template] = parseCardTemplates(demoCardTemplates()).templates;
    expect(template?.workflow).toBe("feature");
    expect(template?.persona).toBe("pessoal");
    expect(template?.pins).toEqual(["docs/adr/0001-design-tokens.md"]);
    expect(template?.spec).toBe("docs/specs/token-change.md");
    // Its criteria become the description's checklist, which the start contract reads (#78).
    expect(template?.description).toContain("- [ ] ");
  });
});
