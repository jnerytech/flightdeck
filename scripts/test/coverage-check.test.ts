import { describe, expect, test } from "bun:test";
import { checkCoverage, hasRuntimeCode, parseLcov } from "../lib/coverage-check.ts";

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

  test("aponta arquivos abaixo de 100% e arquivos nunca carregados", () => {
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

  test("lista os problemas em ordem alfabética sem diferenciar maiúsculas", () => {
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
