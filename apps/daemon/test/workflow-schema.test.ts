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
    expect(errors[0] ?? "").toStartWith("YAML inválido:");
  });

  test("campo desconhecido é erro, na raiz, na etapa e dentro da ação", () => {
    expect(parseWorkflow("steps: []\nfoo: 1\n").errors).toEqual([
      "(raiz): campo desconhecido: foo",
    ]);
    expect(errorsOf("  - id: a\n    check: lint\n    retry: 2")).toEqual([
      "steps.0: campo desconhecido: retry",
    ]);
    expect(errorsOf("  - id: a\n    agent: { prompt: oi, model: x }")).toEqual([
      "steps.0.agent: campo desconhecido: model",
    ]);
  });

  test("etapa sem id é erro", () => {
    expect(errorsOf("  - check: lint")).toEqual(["steps.0.id: obrigatório"]);
  });

  test("etapa precisa de exatamente uma ação, inclusive dentro de loop e parallel", () => {
    expect(errorsOf("  - id: a\n    check: lint\n    pr: {}")).toEqual([
      "steps.0 (a): a etapa precisa de exatamente uma ação (agent, check, gate, loop, parallel ou pr)",
    ]);
    expect(errorsOf("  - id: a")).toEqual([
      "steps.0 (a): a etapa precisa de exatamente uma ação (agent, check, gate, loop, parallel ou pr)",
    ]);
    expect(errorsOf("  - id: a\n    parallel: [{}]")).toEqual([
      "steps.0 (a): parallel.0: precisa de exatamente uma ação (agent ou check)",
    ]);
    expect(errorsOf("  - id: a\n    loop: { max: 1, until: { check: t }, do: {} }")).toEqual([
      "steps.0 (a): loop.do: precisa de exatamente uma ação (agent ou check)",
    ]);
  });

  test("id repetido é erro", () => {
    expect(errorsOf("  - id: a\n    check: lint\n  - id: a\n    check: test")).toEqual([
      "steps.1 (a): id repetido",
    ]);
  });

  test("continue para etapa inexistente (ou que não é agent anterior) é erro", () => {
    expect(errorsOf("  - id: a\n    agent: { continue: nada, prompt: oi }")).toEqual([
      "steps.0 (a): continue para etapa inexistente: nada",
    ]);
    expect(
      errorsOf(
        "  - id: a\n    check: lint\n  - id: b\n    loop: { max: 1, until: { check: t }, do: { agent: { continue: a, prompt: x } } }",
      ),
    ).toEqual(["steps.1 (b): continue para etapa inexistente: a"]);
    expect(
      errorsOf(
        "  - id: b\n    agent: { continue: c, prompt: x }\n  - id: c\n    agent: { prompt: y }",
      ),
    ).toEqual(["steps.0 (b): continue para etapa inexistente: c"]);
  });

  test("referência inexistente em {{…}} é erro de validação, não texto vazio", () => {
    expect(errorsOf("  - id: a\n    agent: { prompt: '{{inputs.nope}}' }")).toEqual([
      "steps.0 (a): referência desconhecida: {{inputs.nope}}",
    ]);
    expect(
      errorsOf(
        "  - id: a\n    agent: { prompt: '{{steps.b.output}}' }\n  - id: b\n    agent: { prompt: x }",
      ),
    ).toEqual(["steps.0 (a): referência desconhecida: {{steps.b.output}}"]);
    expect(
      errorsOf(
        "  - id: a\n    agent: { prompt: x }\n  - id: b\n    gate: { message: '{{steps.a.outputs}}' }",
      ),
    ).toEqual(["steps.1 (b): referência desconhecida: {{steps.a.outputs}}"]);
    expect(
      errorsOf(
        "  - id: a\n    parallel: [{ check: x }]\n  - id: b\n    gate: { message: ok, show: '{{steps.a.output}}' }",
      ),
    ).toEqual(["steps.1 (b): referência desconhecida: {{steps.a.output}}"]);
    expect(errorsOf("  - id: a\n    agent: { prompt: '{{loop.lastCheck.output}}' }")).toEqual([
      "steps.0 (a): referência desconhecida: {{loop.lastCheck.output}}",
    ]);
    expect(
      errorsOf(
        "  - id: a\n    loop: { max: 1, until: { check: t }, do: { agent: { prompt: '{{loop.lastCheck.stdout}} {{ foo }}' } } }",
      ),
    ).toEqual([
      "steps.0 (a): referência desconhecida: {{loop.lastCheck.stdout}}",
      "steps.0 (a): referência desconhecida: {{ foo }}",
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
    ).toEqual(["steps.0.loop.max: precisa ser um inteiro maior que zero"]);
    expect(parseWorkflow("budget: { maxTurns: -1 }\nsteps: []").errors).toEqual([
      "budget.maxTurns: precisa ser maior que zero",
    ]);
    expect(errorsOf("  - id: a\n    check: ''")).toEqual(["steps.0.check: não pode ser vazio"]);
    expect(parseWorkflow("- a\n- b\n").errors).toEqual(["(raiz): precisa ser um objeto"]);
    expect(errorsOf("  - id: a\n    check: 3")).toEqual(["steps.0.check: tipo inválido"]);
    expect(errorsOf("  - id: a\n    agent: { prompt: x, permissionMode: nope }")).toEqual([
      "steps.0.agent.permissionMode: valor inválido",
    ]);
  });
});
