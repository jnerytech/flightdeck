import { describe, expect, test } from "bun:test";
import { checkCommands, parseWorkflow } from "../src/workflows/schema.ts";

const FILE = (steps: string) => `inputs: []\nsteps:\n${steps}`;
const SCAN = `  - id: scan
    agent: { prompt: "Find the debt." }
  - id: raise
    cards: { from: scan }
`;

describe("the cards step (issue #79)", () => {
  test("a cards step names the earlier agent step whose findings it raises", () => {
    const { workflow, errors } = parseWorkflow(FILE(SCAN));
    expect(errors).toEqual([]);
    const raise = workflow?.steps[1];
    expect(raise && "cards" in raise ? raise.cards.from : "").toBe("scan");
  });

  test("it can follow a gate, and a workflow can end on it", () => {
    const steps = `${SCAN.replace("  - id: raise", '  - id: ok\n    gate: { message: "Raise these?", show: "{{steps.scan.output}}" }\n  - id: raise')}`;
    expect(parseWorkflow(FILE(steps)).errors).toEqual([]);
  });

  test("from must be a step that comes earlier and is an agent", () => {
    const later = FILE(`  - id: raise
    cards: { from: scan }
  - id: scan
    agent: { prompt: "Find the debt." }
`);
    expect(parseWorkflow(later).issues).toEqual([
      { path: "steps.0 (raise)", code: "cards_from_unknown", params: { step: "scan" } },
    ]);
    const check = FILE(`  - id: scan
    check: lint
  - id: raise
    cards: { from: scan }
`);
    expect(parseWorkflow(check).issues).toEqual([
      { path: "steps.1 (raise)", code: "cards_from_unknown", params: { step: "scan" } },
    ]);
    expect(parseWorkflow(check).errors).toEqual([
      "steps.1 (raise): cards.from points to an agent step that does not come before it: scan",
    ]);
  });

  test("from cannot be empty, and the step takes nothing else", () => {
    expect(parseWorkflow(FILE(`${SCAN.replace("from: scan", 'from: ""')}`)).issues).toEqual([
      { path: "steps.1.cards.from", code: "not_empty" },
    ]);
    expect(
      parseWorkflow(FILE(`${SCAN.replace("from: scan", "from: scan, max: 99")}`)).errors,
    ).toEqual(["steps.1.cards: unknown field: max"]);
  });

  test("a step does one thing: a cards step with an agent is refused", () => {
    const both = FILE(`  - id: scan
    agent: { prompt: "Find the debt." }
    cards: { from: scan }
`);
    expect(parseWorkflow(both).issues?.map((issue) => issue.code)).toEqual(["step_one_action"]);
  });

  test("a cards step is not a check, so it adds no command to trust", () => {
    const { workflow } = parseWorkflow(FILE(SCAN));
    expect(workflow ? checkCommands(workflow) : ["not parsed"]).toEqual([]);
  });
});
