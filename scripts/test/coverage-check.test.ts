import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COVERAGE_GATE, checkCoverage, hasRuntimeCode, parseLcov } from "../lib/coverage-check.ts";

const lcov = [
  "TN:",
  "SF:apps\\daemon\\src\\a.ts",
  "FNF:2",
  "FNH:2",
  "LF:10",
  "LH:10",
  "end_of_record",
  "TN:",
  "SF:apps/daemon/src/b.ts",
  "FNF:1",
  "FNH:0",
  "LF:4",
  "LH:3",
  "end_of_record",
].join("\n");

describe("cobertura", () => {
  test("parseLcov normaliza caminhos e lê totais", () => {
    expect(parseLcov(lcov)).toEqual(
      new Map([
        ["apps/daemon/src/a.ts", { functions: [2, 2], lines: [10, 10] }],
        ["apps/daemon/src/b.ts", { functions: [0, 1], lines: [3, 4] }],
      ]),
    );
  });

  test("#1002: the gate is 80% of the lines and 80% of the functions of each file", () => {
    expect(COVERAGE_GATE).toBe(80);
    const at = (fn: [number, number], ln: [number, number]) =>
      checkCoverage(new Map([["apps/daemon/src/x.ts", { functions: fn, lines: ln }]]), [
        "apps/daemon/src/x.ts",
      ]);
    expect(at([4, 5], [8, 10])).toEqual([]);
    expect(at([0, 0], [0, 0])).toEqual([]);
    expect(at([4, 5], [7, 10])).toEqual(["apps/daemon/src/x.ts: funções 4/5, linhas 7/10"]);
    expect(at([3, 5], [10, 10])).toEqual(["apps/daemon/src/x.ts: funções 3/5, linhas 10/10"]);
  });

  test("#1002: the whole suite's threshold in bunfig.toml is the same 80%", () => {
    const bunfig = readFileSync(join(import.meta.dir, "../..", "bunfig.toml"), "utf8");
    expect(bunfig).toContain("coverageThreshold = { lines = 0.8, functions = 0.8 }");
  });

  test("aponta arquivos abaixo de 80% e arquivos nunca carregados", () => {
    const problems = checkCoverage(parseLcov(lcov), [
      "apps/daemon/src/a.ts",
      "apps/daemon/src/b.ts",
      "apps/daemon/src/c.ts",
    ]);
    expect(problems).toEqual([
      "apps/daemon/src/b.ts: funções 0/1, linhas 3/4",
      "apps/daemon/src/c.ts: nenhum teste carrega este arquivo",
    ]);
  });

  test("lists the problems alphabetically, with case only as a tie-break", () => {
    const problems = checkCoverage(parseLcov(lcov), [
      "apps/daemon/src/Zeta.ts",
      "apps/daemon/src/alpha.ts",
    ]);
    expect(problems).toEqual([
      "apps/daemon/src/alpha.ts: nenhum teste carrega este arquivo",
      "apps/daemon/src/Zeta.ts: nenhum teste carrega este arquivo",
    ]);
  });

  test("tudo coberto não gera problemas", () => {
    expect(checkCoverage(parseLcov(lcov), ["apps/daemon/src/a.ts"])).toEqual([]);
  });

  test("arquivos só de tipos não têm código em runtime", () => {
    expect(hasRuntimeCode("export interface A { x: number }\nexport type B = A;", "ts")).toBe(
      false,
    );
    expect(hasRuntimeCode('import type { A } from "./a";\nexport type C = A;', "ts")).toBe(false);
    expect(hasRuntimeCode("export const x = 1;", "ts")).toBe(true);
    expect(hasRuntimeCode("export const App = () => <div />;", "tsx")).toBe(true);
  });
});
