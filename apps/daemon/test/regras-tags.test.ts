import { describe, expect, test } from "bun:test";
import { isProd, validateAction } from "../src/actions/schema.ts";

const action = (over: Record<string, unknown> = {}) => ({
  name: "logs-prod",
  description: "logs",
  run: ["journalctl"],
  ...over,
});

describe("regras-tags: as tags de uma ação", () => {
  test("a ação pode ter tags, em minúsculas e sem repetição", () => {
    const { action: loaded, errors } = validateAction(
      action({ tags: ["prod", "Produção", "prod", "api-v2"] }),
    );
    expect(errors).toEqual([]);
    expect(loaded?.tags).toEqual(["prod", "produção", "api-v2"]);
    expect(validateAction(action()).action?.tags).toBeUndefined();
  });

  test("tag que não é texto simples, lista longa demais ou outro formato são erros", () => {
    for (const bad of ["prod", [1], ["com espaço"], ["a".repeat(33)], [""], Array(9).fill("x")]) {
      const { errors } = validateAction(action({ tags: bad }));
      expect(errors.join()).toContain("tags");
    }
    expect(
      validateAction(action({ tags: Array.from({ length: 8 }, (_, i) => `t${i}`) })).errors,
    ).toEqual([]);
  });

  test("isProd reconhece prod e produção, em qualquer caixa", () => {
    expect(isProd(["staging", "prod"])).toBe(true);
    expect(isProd(["Produção"])).toBe(true);
    expect(isProd(["production"])).toBe(false);
    expect(isProd([])).toBe(false);
    expect(isProd(undefined)).toBe(false);
  });
});
