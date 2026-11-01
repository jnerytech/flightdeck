import { expect, test } from "bun:test";
import { parseWorkflow } from "../src/workflows/schema.ts";

const errorsOf = (source: string) => parseWorkflow(source).errors;

test("each problem of a workflow file reads in English for logs and the CLI", () => {
  expect(errorsOf("steps:\n  - id: a\n    agent: { prompt: x, persona: 'Bad Name' }")).toEqual([
    "steps.0.agent.persona: invalid persona id",
  ]);
  expect(errorsOf("steps:\n  - id: a\n    agent: { prompt: '' }")).toEqual([
    "steps.0.agent.prompt: cannot be empty",
  ]);
  expect(
    errorsOf("steps:\n  - id: a\n    loop: { max: 0, until: { check: t }, do: { check: t } }"),
  ).toEqual(["steps.0.loop.max: must be a whole number greater than zero"]);
  expect(errorsOf("steps:\n  - id: a\n    parallel: []")).toEqual([
    "steps.0.parallel: needs at least one item",
  ]);
  expect(errorsOf("inputs: ['bad name!']\nsteps: []")).toEqual(["inputs.0: invalid input name"]);
  expect(errorsOf("budget: { maxMinutes: 0 }\nsteps: []")).toEqual([
    "budget.maxMinutes: must be greater than zero",
  ]);
  expect(errorsOf("budget: { maxTurns: 1.5 }\nsteps: []")).toEqual([
    "budget.maxTurns: must be a whole number greater than zero",
  ]);
  expect(errorsOf("steps: 3")).toEqual(["steps: invalid type"]);
  expect(errorsOf("steps:\n  - id: a\n    check: 5")).toEqual(["steps.0.check: invalid type"]);
  expect(
    errorsOf(
      "steps:\n  - id: a\n    agent: { prompt: x }\n  - id: b\n    agent: { prompt: y, continue: a, persona: reviewer }",
    ),
  ).toEqual(["steps.1 (b): persona does not apply with continue: that step's session exists"]);
});
