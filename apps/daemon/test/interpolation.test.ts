import { describe, expect, test } from "bun:test";
import {
  type InterpolationContext,
  interpolate,
  MAX_VALUE,
  OUTPUTS_SEPARATOR,
} from "../src/workflows/interpolate.ts";

const context: InterpolationContext = {
  inputs: { task: "somar dois números" },
  steps: {
    plan: { output: "1. criar soma.ts" },
    review: { outputs: ["segurança ok", "legibilidade: renomear x"] },
  },
  loop: { lastCheck: { output: "1 fail", exitCode: 1 } },
};

describe("interpolation", () => {
  test("inputs e saída de etapa resolvem", () => {
    expect(interpolate("Planeje: {{inputs.task}}.", context)).toBe("Planeje: somar dois números.");
    expect(interpolate("Plano:\n{{steps.plan.output}}", context)).toBe("Plano:\n1. criar soma.ts");
  });

  test("outputs junta as saídas do parallel na ordem declarada", () => {
    expect(interpolate("{{steps.review.outputs}}", context)).toBe(
      `segurança ok${OUTPUTS_SEPARATOR}legibilidade: renomear x`,
    );
  });

  test("loop.lastCheck traz a saída e o código de retorno", () => {
    expect(interpolate("{{loop.lastCheck.output}} ({{loop.lastCheck.exitCode}})", context)).toBe(
      "1 fail (1)",
    );
  });

  test("espaços dentro das chaves e texto sem referência", () => {
    expect(interpolate("{{ inputs.task }}", context)).toBe("somar dois números");
    expect(interpolate("sem referências", context)).toBe("sem referências");
  });

  test("valor interpolado não é interpolado de novo", () => {
    const tricky = { ...context, inputs: { task: "{{steps.plan.output}}" } };
    expect(interpolate("[{{inputs.task}}]", tricky)).toBe("[{{steps.plan.output}}]");
  });

  test("valor maior que 8 KB é cortado; exatamente 8 KB fica inteiro", () => {
    const big = "a".repeat(MAX_VALUE + 100);
    const exact = "b".repeat(MAX_VALUE);
    expect(MAX_VALUE).toBe(8192);
    expect(interpolate("<{{inputs.big}}>", { ...context, inputs: { big } })).toBe(
      `<${"a".repeat(MAX_VALUE)}>`,
    );
    expect(interpolate("{{inputs.exact}}", { ...context, inputs: { exact } })).toBe(exact);
    const outputs = { steps: { r: { outputs: [big, "fim"] } } };
    expect(interpolate("{{steps.r.outputs}}", { ...context, ...outputs }).length).toBe(MAX_VALUE);
  });

  test("referência sem valor no contexto é erro, não texto vazio", () => {
    expect(() => interpolate("{{inputs.nope}}", context)).toThrow(
      "referência desconhecida: {{inputs.nope}}",
    );
    expect(() => interpolate("{{steps.plan.outputs}}", context)).toThrow(
      "referência desconhecida: {{steps.plan.outputs}}",
    );
    expect(() => interpolate("{{loop.lastCheck.output}}", { ...context, loop: undefined })).toThrow(
      "referência desconhecida: {{loop.lastCheck.output}}",
    );
    expect(() => interpolate("{{outra.coisa}}", context)).toThrow(
      "referência desconhecida: {{outra.coisa}}",
    );
  });
});
