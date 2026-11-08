import { describe, expect, test } from "bun:test";
import { parseCardTemplates } from "../src/board/card-templates.ts";

const entry = (over: Record<string, unknown> = {}) => ({
  id: "bug",
  name: "Bug fix",
  ...over,
});
const parse = (value: unknown) => parseCardTemplates(JSON.stringify(value));

describe("card-templates: the text of cards.json as the templates it offers (#1201)", () => {
  test("a template carries its name, workflow, persona, pins and spec as written", () => {
    const seen = parse([
      entry({
        description: "Fix it.",
        criteria: ["a test fails first", "the fix is small"],
        workflow: "fix",
        persona: "reviewer",
        pins: ["docs/adr/0001-style.md"],
        spec: "docs/specs/bug.md",
      }),
    ]);
    expect(seen).toEqual({
      templates: [
        {
          id: "bug",
          name: "Bug fix",
          description: "Fix it.\n\n- [ ] a test fails first\n- [ ] the fix is small",
          workflow: "fix",
          persona: "reviewer",
          pins: ["docs/adr/0001-style.md"],
          spec: "docs/specs/bug.md",
        },
      ],
      dropped: 0,
      invalid: false,
    });
  });

  test("a template with only a name is a blank card: no text, no workflow, no persona, no pins", () => {
    expect(parse([entry()]).templates).toEqual([
      {
        id: "bug",
        name: "Bug fix",
        description: "",
        workflow: null,
        persona: null,
        pins: [],
        spec: null,
      },
    ]);
  });

  test("only criteria give a checklist, with no blank lines before it", () => {
    expect(parse([entry({ criteria: ["one"] })]).templates[0]?.description).toBe("- [ ] one");
  });

  test("an entry with a mistake is left out and counted; the others are kept", () => {
    const seen = parse([
      entry({ id: "ok" }),
      entry({ id: "" }),
      entry({ id: "no-name", name: "" }),
      entry({ id: "bad-pin", pins: ["src/secret.md"] }),
      entry({ id: "bad-spec", spec: "../outside.md" }),
      entry({ id: "bad-criteria", criteria: [""] }),
      entry({ id: "ok" }),
      { name: "no id" },
      "text",
    ]);
    expect([seen.templates.map((t) => t.id), seen.dropped]).toEqual([["ok"], 8]);
  });

  test("at most 12 templates are offered; the rest are counted", () => {
    const many = Array.from({ length: 14 }, (_, i) => entry({ id: `t${i}`, name: `T${i}` }));
    const seen = parse(many);
    expect([seen.templates.length, seen.dropped]).toEqual([12, 2]);
  });

  test("a file that is not a list of templates is invalid, and offers none", () => {
    for (const text of ["not json", "{}", '{"templates": []}', "42", "null"]) {
      expect([text, parseCardTemplates(text).invalid, parseCardTemplates(text).templates]).toEqual([
        text,
        true,
        [],
      ]);
    }
  });

  test("an empty list is valid and offers none", () => {
    expect(parse([])).toEqual({ templates: [], dropped: 0, invalid: false });
  });

  test("a spec path with a line break or a direction mark is a mistake: it goes into a prompt", () => {
    const seen = parse([
      entry({ id: "a", spec: "docs/specs/a\u2028b.md" }),
      entry({ id: "b", spec: "docs/specs/a\u202eb.md" }),
      entry({ id: "c", spec: "docs/specs/c.md" }),
    ]);
    expect([seen.templates.map((t) => t.id), seen.dropped]).toEqual([["c"], 2]);
  });

  test("more than 10 pins is a mistake", () => {
    const pins = Array.from({ length: 11 }, (_, i) => `docs/adr/d${i}.md`);
    expect(parse([entry({ pins })]).dropped).toBe(1);
  });
});
