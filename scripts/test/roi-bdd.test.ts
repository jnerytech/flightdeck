import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFeature, scenarioTitlesOfSpec } from "../lib/gherkin-lite.ts";

const ROOT = resolve(import.meta.dir, "../..");
const DIR = join(ROOT, "scripts/e2e/bdd/roi");
const SPEC = readFileSync(join(ROOT, "docs/SPEC-fase-36.md"), "utf8");

describe("roi-bdd: reading a feature", () => {
  test("English: the language, the scenarios and the kind of each step, And and But follow the step before", () => {
    const feature = parseFeature(
      [
        "Feature: Did we deliver more?",
        "  free text under the feature",
        "",
        "  Scenario: One",
        "    Given a project",
        "    And a card",
        "    When I open it",
        "    Then I see it",
        "    But not more",
        "",
        "  Scenario: Two",
        '    Given "x"',
        '    When "y"',
        '    Then "z"',
      ].join("\n"),
    );
    expect(feature).toEqual({
      language: "en",
      title: "Did we deliver more?",
      scenarios: [
        {
          title: "One",
          steps: [
            { kind: "given", text: "a project" },
            { kind: "given", text: "a card" },
            { kind: "when", text: "I open it" },
            { kind: "then", text: "I see it" },
            { kind: "then", text: "not more" },
          ],
        },
        {
          title: "Two",
          steps: [
            { kind: "given", text: '"x"' },
            { kind: "when", text: '"y"' },
            { kind: "then", text: '"z"' },
          ],
        },
      ],
    });
  });

  test("Portuguese, with the language comment and tags", () => {
    const feature = parseFeature(
      [
        "# language: pt",
        "@roi",
        "Funcionalidade: Entregamos mais?",
        "  Cenário: Um",
        "    Dado um projeto",
        "    E um card",
        "    Quando abro",
        "    Então vejo",
        "    Mas não mais",
      ].join("\n"),
    );
    expect(feature.language).toBe("pt");
    expect(feature.title).toBe("Entregamos mais?");
    expect(feature.scenarios[0]?.steps.map((s) => s.kind)).toEqual([
      "given",
      "given",
      "when",
      "then",
      "then",
    ]);
  });

  test("a step before any scenario, or an And with nothing before it, is refused", () => {
    expect(() => parseFeature("Feature: x\n  Given a thing")).toThrow("outside a scenario");
    expect(() => parseFeature("Feature: x\n  Scenario: y\n    And a thing")).toThrow(
      "nothing before it",
    );
  });
});

describe("roi-bdd: the scenarios of the spec", () => {
  test("the titles come from the gherkin blocks of the spec", () => {
    expect(
      scenarioTitlesOfSpec(
        [
          "text",
          "```gherkin",
          "Feature: a",
          "  Scenario: First",
          "```",
          "  Scenario: not here",
          "```gherkin",
          "  Scenario: Second",
          "```",
        ].join("\n"),
      ),
    ).toEqual(["First", "Second"]);
  });

  const files = (existsSync(DIR) ? readdirSync(DIR) : []).filter((f) => f.endsWith(".feature"));
  const parsed = () =>
    [...files]
      .sort()
      .map((f) => ({ file: f, feature: parseFeature(readFileSync(join(DIR, f), "utf8")) }));

  test("the English features hold every scenario of the spec, and no other", () => {
    const titles = parsed().flatMap((p) => p.feature.scenarios.map((s) => s.title));
    expect(titles.sort()).toEqual(scenarioTitlesOfSpec(SPEC).sort());
    expect(titles).toHaveLength(14);
  });

  test("every feature is in English, and there is no Portuguese twin (the app language is a run parameter)", () => {
    expect(files.filter((f) => /\.(en|pt)\.feature$/.test(f))).toEqual([]);
    expect(parsed().length).toBeGreaterThan(0);
    for (const { feature } of parsed()) expect(feature.language).toBe("en");
  });

  test("every scenario has a Given, a When and a Then, and no step is empty", () => {
    for (const { file, feature } of parsed()) {
      for (const scenario of feature.scenarios) {
        const kinds = new Set(scenario.steps.map((s) => s.kind));
        expect({ file, scenario: scenario.title, kinds: [...kinds].sort() }).toEqual({
          file,
          scenario: scenario.title,
          kinds: ["given", "then", "when"],
        });
        expect(scenario.steps.every((s) => s.text.trim() !== "")).toBe(true);
      }
    }
  });
});
