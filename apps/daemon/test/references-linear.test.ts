import { describe, expect, test } from "bun:test";
import { referencesIn, replaceReferences } from "../src/references.ts";
import { parseRunConfig } from "../src/runenv/config.ts";
import { interpolate } from "../src/workflows/interpolate.ts";
import { parseWorkflow } from "../src/workflows/schema.ts";

/**
 * Issue #363 (Sonar S8786): the `{{ expression }}` scanner of a workflow prompt and of a run
 * config reads its text in one pass. The answers are pinned, and a text with many `{{` and no `}}`
 * must be read in a moment: with the regex it had, the time grew with the cube of the length.
 */
const FAST_MS = 1500;
const took = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

const context = { inputs: { x: "1", y: "2" }, steps: {} };

describe("references-linear: interpolate (every {{ expression }} replaced by its value)", () => {
  test.each([
    ["a {{ inputs.x }} b", "a 1 b"],
    ["{{inputs.x}}{{inputs.y}}", "12"],
    ["{{ inputs.x \n }}", "1"],
    ["{{\n inputs.x }}", "1"],
    ["{{ inputs.x}}", "1"],
    ["{{inputs.x}}}", "1}"],
    ["{{ inputs\n.x }}", "{{ inputs\n.x }}"],
    ["{{ inputs.x", "{{ inputs.x"],
    ["{{inputs.x}", "{{inputs.x}"],
    ["{ {inputs.x}}", "{ {inputs.x}}"],
    ["no references", "no references"],
    ["", ""],
  ])("%j gives %j", (template, expected) => {
    expect(interpolate(template, context)).toBe(expected);
  });

  test.each([
    ["{{ {{inputs.x}} }}", "{{ {{inputs.x}}"],
    ["{{{inputs.x}}", "{{{inputs.x}}"],
    ["{{{{inputs.x}}", "{{{{inputs.x}}"],
    ["{{inputs.z}}", "{{inputs.z}}"],
    ["{{}}", "{{}}"],
  ])("%j is an unknown reference named %j", (template, raw) => {
    expect(() => interpolate(template, context)).toThrow(`referência desconhecida: ${raw}`);
  });

  test("a text of opening braces and no closing ones is read in a moment", () => {
    expect(took(() => interpolate("{{ ".repeat(40_000), context))).toBeLessThan(FAST_MS);
    expect(took(() => interpolate(`{{${" ".repeat(120_000)}a`, context))).toBeLessThan(FAST_MS);
  });

  test("opening braces followed by a line break and no closing ones are read in a moment", () => {
    expect(took(() => interpolate(`${"{{ ".repeat(40_000)}\nx`, context))).toBeLessThan(FAST_MS);
    expect(took(() => interpolate("{{ x\n".repeat(30_000), context))).toBeLessThan(FAST_MS);
  });
});

describe("references-linear: the run config's {{port.name}} references", () => {
  const run = (cmd: string) =>
    `run:\n  - { name: a, cmd: ["x", ${JSON.stringify(cmd)}] }\nports: [web]\n`;

  test.each([
    ["{{port.web}}", []],
    ["{{ port.web }}", []],
    ["{{port.api}}", ["run.0.cmd.1: port not declared: api"]],
    ["{{ inputs.x }}", ["run.0.cmd.1: unknown reference: {{ inputs.x }}"]],
    ["{{ port.web \n }} {{port.web}}", []],
    ["{{ port\n.web }}", []],
    ["{{port.web", []],
  ])("%j has the problems %j", (cmd, errors) => {
    expect(parseRunConfig(run(cmd)).errors).toEqual(errors);
  });

  test("a command of opening braces and no closing ones is read in a moment", () => {
    expect(took(() => parseRunConfig(run("{{ ".repeat(40_000))))).toBeLessThan(FAST_MS);
    expect(took(() => parseRunConfig(run(`{{${" ".repeat(120_000)}a`)))).toBeLessThan(FAST_MS);
  });
});

describe("references-linear: the workflow's {{ expression }} references", () => {
  const prompt = (text: string) =>
    parseWorkflow(
      `inputs: [task]\nsteps:\n  - id: a\n    agent: { prompt: ${JSON.stringify(text)} }`,
    ).errors;

  test.each([
    ["{{inputs.task}} {{ inputs.task }}", []],
    ["{{inputs.nope}}", ["steps.0 (a): unknown reference: {{inputs.nope}}"]],
    ["{{ inputs.task\n }}", []],
    ["{{ inputs\n.nope }}", []],
    ["{{ x", []],
  ])("%j has the problems %j", (text, errors) => {
    expect(prompt(text)).toEqual(errors);
  });

  test("a prompt of opening braces and no closing ones is read in a moment", () => {
    expect(took(() => prompt("{{ ".repeat(40_000)))).toBeLessThan(FAST_MS);
    expect(took(() => prompt(`{{${" ".repeat(120_000)}a`))).toBeLessThan(FAST_MS);
  });
});

describe("references-linear: referencesIn and replaceReferences (what the three above are made of)", () => {
  test("each reference gives its text, its expression without the white space around it, and where it starts", () => {
    expect(referencesIn("a {{ b.c }} d {{e}}\n{{\n f \n}}")).toEqual([
      { raw: "{{ b.c }}", expression: "b.c", index: 2 },
      { raw: "{{e}}", expression: "e", index: 14 },
      { raw: "{{\n f \n}}", expression: "f", index: 20 },
    ]);
  });

  test("an opening brace that cannot close is dropped and the next one is still found", () => {
    expect(referencesIn("{{ a\nb }} {{ c }}").map((r) => r.raw)).toEqual(["{{ c }}"]);
    expect(referencesIn("{{ {{ a\n {{ b }}").map((r) => r.raw)).toEqual(["{{ b }}"]);
    // The second brace of `{{{` can open the reference the first one could not.
    expect(referencesIn("{{{ \n x}}")).toEqual([{ raw: "{{ \n x}}", expression: "x", index: 1 }]);
    // The white space after `{{` takes line breaks too, so this one is a single reference.
    expect(referencesIn("{{ \n {{ b }}").map((r) => r.expression)).toEqual(["{{ b"]);
  });

  test("a replaced text keeps what is between the references, and `$` in a value is kept as it is", () => {
    expect(replaceReferences("x {{a}} y {{ b }} z", (_raw, e) => `[$&${e}]`)).toBe(
      "x [$&a] y [$&b] z",
    );
    expect(replaceReferences("none", () => "never")).toBe("none");
  });
});
