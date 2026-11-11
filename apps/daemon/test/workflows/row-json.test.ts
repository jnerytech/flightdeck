import { describe, expect, test } from "bun:test";
import {
  budgetOf,
  inputsOf,
  reasonParamsOf,
  spendingOf,
  stepUsageOf,
} from "../../src/workflows/row-json.ts";

describe("row-json: the JSON columns of a workflow run", () => {
  test("a run's spending is read with what each session spent", () => {
    const text = '{"turns":2,"minutes":1.5,"costUsd":0.25,"sessions":{"s1":0.25}}';
    expect(spendingOf(text)).toEqual({
      turns: 2,
      minutes: 1.5,
      costUsd: 0.25,
      sessions: { s1: 0.25 },
    });
  });
  test("a spending without the sessions map reads with none", () => {
    expect(spendingOf('{"turns":0,"minutes":0,"costUsd":0}')).toEqual({
      turns: 0,
      minutes: 0,
      costUsd: 0,
      sessions: {},
    });
  });
  test("a spending that does not fit throws, so a run never loses its tally and passes its budget", () => {
    expect(() => spendingOf('{"turns":"2"}')).toThrow();
    expect(() => spendingOf("{nope")).toThrow();
  });
  test("a budget keeps its limits, and one that does not fit throws", () => {
    expect(budgetOf('{"maxTurns":5,"maxCostUsd":1.5}')).toEqual({ maxTurns: 5, maxCostUsd: 1.5 });
    expect(() => budgetOf('{"maxTurns":"5"}')).toThrow();
  });
  test("inputs are text by name, and a non-text value throws", () => {
    expect(inputsOf('{"branch":"main"}')).toEqual({ branch: "main" });
    expect(() => inputsOf('{"n":1}')).toThrow();
  });
  test("a step's usage reads as none when absent or unreadable", () => {
    expect(stepUsageOf(null)).toBeNull();
    expect(stepUsageOf('{"turns":1,"minutes":2,"costUsd":0.5}')).toEqual({
      turns: 1,
      minutes: 2,
      costUsd: 0.5,
    });
    expect(stepUsageOf("{nope")).toBeNull();
  });
  test("reason params that are not text or numbers by name read as none", () => {
    expect(reasonParamsOf('{"n":2,"name":"x"}')).toEqual({ n: 2, name: "x" });
    expect(reasonParamsOf('{"n":[1]}')).toBeNull();
  });
});
