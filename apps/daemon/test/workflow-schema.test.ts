import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkCommands, parseWorkflow } from "../src/workflows/schema.ts";

const EXAMPLE = readFileSync(join(import.meta.dir, "fixtures/workflows/feature.yaml"), "utf8");

/** Errors of a workflow made of `steps` (YAML lines under `steps:`), with `inputs: [task]`. */
const errorsOf = (steps: string, head = "inputs: [task]") =>
  parseWorkflow(`${head}\nsteps:\n${steps}`).errors;

describe("workflow-schema", () => {
  test("o exemplo da spec carrega, com etapas, orçamento e comandos check", () => {
    const { workflow, errors } = parseWorkflow(EXAMPLE);
    expect(errors).toEqual([]);
    expect(workflow?.name).toBe("feature");
    expect(workflow?.inputs).toEqual(["task"]);
    expect(workflow?.budget).toEqual({ maxTurns: 80, maxMinutes: 120, maxCostUsd: 15 });
    expect(workflow?.steps.map((s) => s.id)).toEqual([
      "plan",
      "approve-plan",
      "implement",
      "tests",
      "review",
      "apply-review",
      "pr",
    ]);
    expect(workflow?.steps[0]).toEqual({
      id: "plan",
      agent: {
        prompt: "Planeje a implementação de: {{inputs.task}}. Responda só com o plano.",
        permissionMode: "plan",
      },
    });
    expect(workflow ? checkCommands(workflow) : []).toEqual(["bun test"]);
  });

  test("sem inputs nem orçamento, os dois ficam vazios", () => {
    const { workflow, errors } = parseWorkflow("steps:\n  - id: a\n    check: lint\n");
    expect(errors).toEqual([]);
    expect(workflow).toEqual({ inputs: [], budget: {}, steps: [{ id: "a", check: "lint" }] });
  });

  test("comandos check de etapas, loops e paralelos, sem repetição e na ordem", () => {
    const { workflow } = parseWorkflow(
      [
        "steps:",
        "  - id: a",
        "    check: lint",
        "  - id: b",
        "    loop: { max: 2, until: { check: test }, do: { check: fix } }",
        "  - id: c",
        "    parallel: [{ check: lint }, { check: build }]",
      ].join("\n"),
    );
    expect(workflow ? checkCommands(workflow) : []).toEqual(["lint", "test", "fix", "build"]);
  });

  test("YAML inválido é erro de validação", () => {
    const { workflow, errors } = parseWorkflow("steps: [unterminated");
    expect(workflow).toBeNull();
    expect(errors[0] ?? "").toStartWith("invalid YAML:");
  });

  test("campo desconhecido é erro, na raiz, na etapa e dentro da ação", () => {
    expect(parseWorkflow("steps: []\nfoo: 1\n").errors).toEqual(["(root): unknown field: foo"]);
    expect(errorsOf("  - id: a\n    check: lint\n    retry: 2")).toEqual([
      "steps.0: unknown field: retry",
    ]);
    expect(errorsOf("  - id: a\n    agent: { prompt: oi, model: x }")).toEqual([
      "steps.0.agent: unknown field: model",
    ]);
  });

  test("etapa sem id é erro", () => {
    expect(errorsOf("  - check: lint")).toEqual(["steps.0.id: required"]);
  });

  test("etapa precisa de exatamente uma ação, inclusive dentro de loop e parallel", () => {
    expect(errorsOf("  - id: a\n    check: lint\n    pr: {}")).toEqual([
      "steps.0 (a): the step needs exactly one action (agent, check, gate, loop, parallel or pr)",
    ]);
    expect(errorsOf("  - id: a")).toEqual([
      "steps.0 (a): the step needs exactly one action (agent, check, gate, loop, parallel or pr)",
    ]);
    expect(errorsOf("  - id: a\n    parallel: [{}]")).toEqual([
      "steps.0 (a): parallel.0: needs exactly one action (agent or check)",
    ]);
    expect(errorsOf("  - id: a\n    loop: { max: 1, until: { check: t }, do: {} }")).toEqual([
      "steps.0 (a): loop.do: needs exactly one action (agent or check)",
    ]);
  });

  test("repeated id é erro", () => {
    expect(errorsOf("  - id: a\n    check: lint\n  - id: a\n    check: test")).toEqual([
      "steps.1 (a): repeated id",
    ]);
  });

  test("continue points to a step that does not exist (ou que não é agent anterior) é erro", () => {
    expect(errorsOf("  - id: a\n    agent: { continue: nada, prompt: oi }")).toEqual([
      "steps.0 (a): continue points to a step that does not exist: nada",
    ]);
    expect(
      errorsOf(
        "  - id: a\n    check: lint\n  - id: b\n    loop: { max: 1, until: { check: t }, do: { agent: { continue: a, prompt: x } } }",
      ),
    ).toEqual(["steps.1 (b): continue points to a step that does not exist: a"]);
    expect(
      errorsOf(
        "  - id: b\n    agent: { continue: c, prompt: x }\n  - id: c\n    agent: { prompt: y }",
      ),
    ).toEqual(["steps.0 (b): continue points to a step that does not exist: c"]);
  });

  test("referência inexistente em {{…}} é erro de validação, não texto vazio", () => {
    expect(errorsOf("  - id: a\n    agent: { prompt: '{{inputs.nope}}' }")).toEqual([
      "steps.0 (a): unknown reference: {{inputs.nope}}",
    ]);
    expect(
      errorsOf(
        "  - id: a\n    agent: { prompt: '{{steps.b.output}}' }\n  - id: b\n    agent: { prompt: x }",
      ),
    ).toEqual(["steps.0 (a): unknown reference: {{steps.b.output}}"]);
    expect(
      errorsOf(
        "  - id: a\n    agent: { prompt: x }\n  - id: b\n    gate: { message: '{{steps.a.outputs}}' }",
      ),
    ).toEqual(["steps.1 (b): unknown reference: {{steps.a.outputs}}"]);
    expect(
      errorsOf(
        "  - id: a\n    parallel: [{ check: x }]\n  - id: b\n    gate: { message: ok, show: '{{steps.a.output}}' }",
      ),
    ).toEqual(["steps.1 (b): unknown reference: {{steps.a.output}}"]);
    expect(errorsOf("  - id: a\n    agent: { prompt: '{{loop.lastCheck.output}}' }")).toEqual([
      "steps.0 (a): unknown reference: {{loop.lastCheck.output}}",
    ]);
    expect(
      errorsOf(
        "  - id: a\n    loop: { max: 1, until: { check: t }, do: { agent: { prompt: '{{loop.lastCheck.stdout}} {{ foo }}' } } }",
      ),
    ).toEqual([
      "steps.0 (a): unknown reference: {{loop.lastCheck.stdout}}",
      "steps.0 (a): unknown reference: {{ foo }}",
    ]);
  });

  test("referências válidas passam: inputs, saídas anteriores e lastCheck dentro do loop", () => {
    const errors = errorsOf(
      [
        "  - id: a",
        "    agent: { prompt: '{{inputs.task}}' }",
        "  - id: b",
        "    parallel: [{ agent: { prompt: '{{ steps.a.output }}' } }]",
        "  - id: c",
        "    loop:",
        "      max: 2",
        "      until: { check: t }",
        "      do: { agent: { continue: a, prompt: '{{loop.lastCheck.output}} {{loop.lastCheck.exitCode}} {{steps.b.outputs}}' } }",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
  });

  test("tipos errados e valores fora do intervalo são erros", () => {
    expect(
      errorsOf("  - id: a\n    loop: { max: 0, until: { check: t }, do: { check: x } }"),
    ).toEqual(["steps.0.loop.max: must be a whole number greater than zero"]);
    expect(parseWorkflow("budget: { maxTurns: -1 }\nsteps: []").errors).toEqual([
      "budget.maxTurns: must be greater than zero",
    ]);
    expect(errorsOf("  - id: a\n    check: ''")).toEqual(["steps.0.check: cannot be empty"]);
    expect(parseWorkflow("- a\n- b\n").errors).toEqual(["(root): must be an object"]);
    expect(errorsOf("  - id: a\n    check: 3")).toEqual(["steps.0.check: invalid type"]);
    expect(errorsOf("  - id: a\n    agent: { prompt: x, permissionMode: nope }")).toEqual([
      "steps.0.agent.permissionMode: invalid value",
    ]);
  });
});

describe("workflow-schema: the issues, for the app to translate", () => {
  const issuesOf = (steps: string, head = "inputs: [task]") =>
    parseWorkflow(`${head}\nsteps:\n${steps}`).issues;

  test("each problem is a path, a code and its params", () => {
    expect(parseWorkflow("steps: [unterminated").issues[0]?.code).toBe("yaml_invalid");
    expect(parseWorkflow("steps: []\nfoo: 1\n").issues).toEqual([
      { path: "(root)", code: "unknown_field", params: { field: "foo" } },
    ]);
    expect(issuesOf("  - check: lint")).toEqual([{ path: "steps.0.id", code: "required" }]);
    expect(issuesOf("  - id: a\n    check: lint\n    pr: {}")).toEqual([
      { path: "steps.0 (a)", code: "step_one_action" },
    ]);
    expect(issuesOf("  - id: a\n    check: lint\n  - id: a\n    check: test")).toEqual([
      { path: "steps.1 (a)", code: "step_id_duplicate" },
    ]);
    expect(issuesOf("  - id: a\n    agent: { prompt: '{{inputs.nope}}' }")).toEqual([
      { path: "steps.0 (a)", code: "reference_unknown", params: { ref: "{{inputs.nope}}" } },
    ]);
    expect(issuesOf("  - id: b\n    agent: { continue: a, prompt: oi }")).toEqual([
      { path: "steps.0 (b)", code: "continue_unknown", params: { step: "a" } },
    ]);
    expect(
      issuesOf("  - id: a\n    loop: { max: 0, until: { check: t }, do: { check: x } }"),
    ).toEqual([{ path: "steps.0.loop.max", code: "positive_int" }]);
  });

  test("a valid workflow has no issues", () => {
    expect(parseWorkflow("steps:\n  - id: a\n    check: lint\n").issues).toEqual([]);
  });
});
